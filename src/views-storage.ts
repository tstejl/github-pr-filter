import { parseStoredLifecycleLayout } from "./lifecycle-storage";
import {
  createDefaultViewLayout,
  migrateLifecycleLayout,
  normalizeViewRepository,
  parseViewLayout,
  type ViewLayout
} from "./saved-views";

export interface ViewScopeSnapshot {
  scope: string;
  layout: ViewLayout;
  revision: string;
  readOnly: boolean;
}
export interface ViewsStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
interface ExtensionApi {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: {
    local: ViewsStorageArea;
    onChanged: {
      addListener(listener: (changes: Record<string, unknown>, area: string) => void): void;
      removeListener(listener: (changes: Record<string, unknown>, area: string) => void): void;
    };
  };
}
export function viewsExtensionApi(): ExtensionApi {
  const globals = globalThis as typeof globalThis & {
    chrome?: ExtensionApi;
    browser?: ExtensionApi;
  };
  const api = globals.browser ?? globals.chrome;
  if (!api?.storage?.local) throw new Error("Extension storage is unavailable.");
  return api;
}
const PREFIX = "savedViews:";
export function viewScopeStorageKey(scope: string): string {
  if (scope !== "global" && normalizeViewRepository(scope) !== scope)
    throw new Error("Choose a valid repository (owner/name).");
  return `${PREFIX}${scope}`;
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)])
    );
  return value;
}
function revision(value: unknown): string {
  // Browser storage may return object properties in a different order than the
  // submitted object. Array order is meaningful; object property order is not.
  return value === undefined ? "absent" : JSON.stringify(stableValue(value));
}
export async function loadViewScope(
  scope: string,
  storage: ViewsStorageArea = viewsExtensionApi().storage.local
): Promise<ViewScopeSnapshot> {
  const key = viewScopeStorageKey(scope);
  const stored = await storage.get(key);
  const raw = stored[key];
  const fallback =
    scope === "global" ? { version: 1 as const, entries: [] } : createDefaultViewLayout();
  if (raw !== undefined) {
    const parsed = parseViewLayout(raw);
    // Unknown/corrupt data is preserved. The manager must not silently replace it.
    return { scope, layout: parsed ?? fallback, revision: revision(raw), readOnly: !parsed };
  }
  if (scope !== "global") {
    const oldKeys = [`repositoryLifecycleLayout:${scope}`, `repositoryLifecycleLayout:v2:${scope}`];
    const legacy = await storage.get(oldKeys);
    const legacyKey = Object.hasOwn(legacy, oldKeys[0] ?? "")
      ? (oldKeys[0] ?? "")
      : (oldKeys[1] ?? "");
    const rawLegacy = legacy[legacyKey];
    if (rawLegacy !== undefined) {
      const legacyRevision = `legacy:${revision([legacyKey, rawLegacy])}`;
      const parsed = parseStoredLifecycleLayout(rawLegacy);
      if (!parsed) return { scope, layout: fallback, revision: legacyRevision, readOnly: true };
      return {
        scope,
        layout: migrateLifecycleLayout(parsed),
        revision: legacyRevision,
        readOnly: false
      };
    }
  }
  return { scope, layout: fallback, revision: "absent", readOnly: false };
}
export async function listViewRepositories(
  storage: ViewsStorageArea = viewsExtensionApi().storage.local
): Promise<string[]> {
  const all = await storage.get(null);
  const repositories = new Set<string>();
  for (const key of Object.keys(all)) {
    if (!key.startsWith(PREFIX) && !key.startsWith("repositoryLifecycleLayout:")) continue;
    const scope = key.startsWith(PREFIX)
      ? key.slice(PREFIX.length)
      : key.replace(/^repositoryLifecycleLayout:(?:v2:)?/u, "");
    if (normalizeViewRepository(scope)) repositories.add(scope);
  }
  return [...repositories].toSorted();
}

/** Called only by the background's serialized writer; all scope moves use one set. */
export async function commitViewScopes(
  value: unknown,
  storage: ViewsStorageArea = viewsExtensionApi().storage.local
): Promise<void> {
  if (!Array.isArray(value) || !value.length || value.length > 2)
    throw new Error("Invalid view settings update.");
  const updates = new Map<string, { layout: ViewLayout; revision: string }>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid view settings update.");
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.scope !== "string" || typeof candidate.revision !== "string")
      throw new Error("Invalid view settings update.");
    const key = viewScopeStorageKey(candidate.scope);
    const layout = parseViewLayout(candidate.layout);
    if (!layout || updates.has(key)) throw new Error("Invalid view settings layout.");
    updates.set(key, { layout, revision: candidate.revision });
  }
  const current = await storage.get([...updates.keys()]);
  const originals = new Map(
    await Promise.all(
      [...updates.keys()].map(
        async (key) =>
          [
            key,
            current[key] === undefined
              ? await loadViewScope(key.slice(PREFIX.length), storage)
              : null
          ] as const
      )
    )
  );
  const write: Record<string, ViewLayout> = {};
  for (const [key, update] of updates) {
    const original = originals.get(key);
    if ((original?.revision ?? revision(current[key])) !== update.revision)
      throw new Error(
        "These views changed in another tab. Reload saved views before saving; your draft is still here."
      );
    if (current[key] !== undefined && !parseViewLayout(current[key]))
      throw new Error(
        "This saved layout is unreadable or belongs to a newer version. It has been preserved."
      );
    if (original?.readOnly)
      throw new Error(
        "An unreadable or newer legacy layout has been preserved. Update the extension before saving this repository."
      );
    write[key] = update.layout;
  }
  await storage.set(write);
}
export async function saveViewScopes(updates: ViewScopeSnapshot[]): Promise<void> {
  const payload = updates.map((update) => {
    const layout = parseViewLayout(update.layout);
    if (!layout) throw new Error("Invalid view layout.");
    return { ...update, layout };
  });
  const response = await viewsExtensionApi().runtime.sendMessage({
    type: "gprf:save-views",
    updates: payload
  });
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true) {
    throw new Error(
      response && typeof response === "object" && "error" in response
        ? String(response.error)
        : "Could not save views. Try again."
    );
  }
  for (const [index, saved] of payload.entries()) {
    const update = updates[index];
    if (!update) continue;
    update.layout = saved.layout;
    update.revision = revision(saved.layout);
    update.readOnly = false;
  }
}
export function subscribeViewScopes(listener: (scope: string) => void): () => void {
  const event = viewsExtensionApi().storage.onChanged;
  const onChange = (changes: Record<string, unknown>, area: string): void => {
    if (area !== "local") return;
    for (const key of Object.keys(changes))
      if (key.startsWith(PREFIX)) listener(key.slice(PREFIX.length));
  };
  event.addListener(onChange);
  return () => event.removeListener(onChange);
}
