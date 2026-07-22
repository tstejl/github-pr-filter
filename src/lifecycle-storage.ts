import {
  cloneLifecycleLayout,
  DEFAULT_LIFECYCLE_LAYOUT,
  LIFECYCLE_LAYOUT_VERSION,
  type LifecycleLayout,
  type LifecycleLayoutEntry
} from "./lifecycle-layout";
import { isLifecycle, LIFECYCLES } from "./lifecycle";

const LEGACY_STORAGE_KEY_PREFIX = "repositoryLifecycleLayout:";
const STORAGE_KEY_PREFIX = `${LEGACY_STORAGE_KEY_PREFIX}v${LIFECYCLE_LAYOUT_VERSION}:`;

export interface ExtensionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ExtensionStorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export type ExtensionStorageChangeListener = (
  changes: Record<string, ExtensionStorageChange>,
  areaName: string
) => void;

export interface ExtensionStorageChangeEvent {
  addListener(listener: ExtensionStorageChangeListener): void;
  removeListener(listener: ExtensionStorageChangeListener): void;
}

interface ExtensionStorageApi {
  readonly storage?: {
    readonly local?: ExtensionStorageArea;
    readonly onChanged?: ExtensionStorageChangeEvent;
  };
}

const repositoryWriteQueues = new Map<string, Promise<void>>();

function extensionApi(): ExtensionStorageApi {
  const extensionGlobals = globalThis as typeof globalThis & {
    browser?: ExtensionStorageApi;
    chrome?: ExtensionStorageApi;
  };
  return extensionGlobals.browser ?? extensionGlobals.chrome ?? {};
}

function extensionStorage(): ExtensionStorageArea {
  const storage = extensionApi().storage?.local;
  if (!storage) {
    throw new Error("Extension storage is unavailable.");
  }
  return storage;
}

export function storageKeyForRepository(repository: string): string {
  return `${STORAGE_KEY_PREFIX}${repository}`;
}

function legacyStorageKeyForRepository(repository: string): string {
  return `${LEGACY_STORAGE_KEY_PREFIX}${repository}`;
}

function repositoryForStorageKey(key: string): string | null {
  if (!key.startsWith(STORAGE_KEY_PREFIX)) {
    return null;
  }
  const repository = key.slice(STORAGE_KEY_PREFIX.length);
  return repository || null;
}

interface ParsedLifecycleLayout {
  readonly layout: LifecycleLayout;
  readonly migrated: boolean;
}

function parseStoredLifecycleLayoutValue(value: unknown): ParsedLifecycleLayout | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as { version?: unknown; entries?: unknown };
  if (
    (candidate.version !== 1 && candidate.version !== LIFECYCLE_LAYOUT_VERSION) ||
    !Array.isArray(candidate.entries)
  ) {
    return null;
  }

  const entries: LifecycleLayoutEntry[] = [];
  const lifecycleValues = new Set<string>();
  const dividerIds = new Set<string>();
  let visibleOptions = 0;
  for (const rawEntry of candidate.entries) {
    if (!rawEntry || typeof rawEntry !== "object") {
      return null;
    }
    const entry = rawEntry as Record<string, unknown>;
    if (entry.type === "option") {
      if (
        typeof entry.value !== "string" ||
        !isLifecycle(entry.value) ||
        typeof entry.visible !== "boolean"
      ) {
        return null;
      }
      if (lifecycleValues.has(entry.value)) {
        return null;
      }
      lifecycleValues.add(entry.value);
      visibleOptions += entry.visible ? 1 : 0;
      entries.push({ type: "option", value: entry.value, visible: entry.visible });
      continue;
    }
    if (entry.type === "divider" && typeof entry.id === "string" && entry.id) {
      if (dividerIds.has(entry.id)) {
        return null;
      }
      dividerIds.add(entry.id);
      entries.push({ type: "divider", id: entry.id });
      continue;
    }
    return null;
  }

  if (visibleOptions === 0) {
    return null;
  }

  const expectedLifecycles =
    candidate.version === 1 ? LIFECYCLES.filter((lifecycle) => lifecycle !== "all") : LIFECYCLES;
  const hasEveryExpectedLifecycle = expectedLifecycles.every((lifecycle) =>
    lifecycleValues.has(lifecycle)
  );
  if (lifecycleValues.size !== expectedLifecycles.length || !hasEveryExpectedLifecycle) {
    return null;
  }

  const migrated = candidate.version === 1;
  if (migrated) {
    entries.unshift({ type: "option", value: "all", visible: true });
  }
  return {
    layout: { version: LIFECYCLE_LAYOUT_VERSION, entries },
    migrated
  };
}

export function parseStoredLifecycleLayout(value: unknown): LifecycleLayout | null {
  return parseStoredLifecycleLayoutValue(value)?.layout ?? null;
}

export async function loadRepositoryLifecycleLayout(
  repository: string,
  storage: ExtensionStorageArea = extensionStorage()
): Promise<LifecycleLayout> {
  const key = storageKeyForRepository(repository);
  let stored = await storage.get(key);
  let storedKey = key;
  let fromLegacyKey = false;
  if (!(key in stored)) {
    storedKey = legacyStorageKeyForRepository(repository);
    stored = await storage.get(storedKey);
    fromLegacyKey = storedKey in stored;
  }
  if (!(storedKey in stored)) {
    return cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
  }
  const storedValue = stored[storedKey];
  const storedVersion =
    storedValue && typeof storedValue === "object"
      ? (storedValue as { version?: unknown }).version
      : undefined;
  if (typeof storedVersion === "number" && storedVersion > LIFECYCLE_LAYOUT_VERSION) {
    return cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
  }
  const parsed = parseStoredLifecycleLayoutValue(storedValue);
  if (parsed) {
    if (parsed.migrated || fromLegacyKey) {
      try {
        await saveRepositoryLifecycleLayout(repository, parsed.layout, storage);
        if (fromLegacyKey) {
          await storage.remove(storedKey);
        }
      } catch (error) {
        console.error(
          "[GitHub PR Lifecycle Filter] Could not persist a migrated repository layout.",
          error
        );
      }
    }
    return parsed.layout;
  }
  try {
    await storage.remove(storedKey);
  } catch (error) {
    console.error(
      "[GitHub PR Lifecycle Filter] Could not remove a corrupted repository layout.",
      error
    );
  }
  return cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
}

export async function saveRepositoryLifecycleLayout(
  repository: string,
  layout: LifecycleLayout,
  storage: ExtensionStorageArea = extensionStorage()
): Promise<void> {
  const key = storageKeyForRepository(repository);
  const previousWrite = repositoryWriteQueues.get(key) ?? Promise.resolve();
  const write = previousWrite
    .catch(() => undefined)
    .then(() => storage.set({ [key]: cloneLifecycleLayout(layout) }));
  repositoryWriteQueues.set(key, write);
  try {
    await write;
  } finally {
    if (repositoryWriteQueues.get(key) === write) {
      repositoryWriteQueues.delete(key);
    }
  }
}

export function subscribeRepositoryLifecycleLayouts(
  listener: (repository: string, layout: LifecycleLayout) => void,
  changes: ExtensionStorageChangeEvent | undefined = extensionApi().storage?.onChanged
): () => void {
  if (!changes) {
    return () => undefined;
  }
  const onChanged: ExtensionStorageChangeListener = (storageChanges, areaName) => {
    if (areaName !== "local") {
      return;
    }
    for (const [key, change] of Object.entries(storageChanges)) {
      const repository = repositoryForStorageKey(key);
      if (!repository) {
        continue;
      }
      const layout =
        parseStoredLifecycleLayout(change.newValue) ??
        cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
      listener(repository, layout);
    }
  };
  changes.addListener(onChanged);
  return () => changes.removeListener(onChanged);
}
