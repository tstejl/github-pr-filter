import * as assert from "node:assert/strict";
import { test } from "bun:test";
import { DEFAULT_LIFECYCLE_LAYOUT } from "../src/lifecycle-layout";
import { createDefaultViewLayout } from "../src/saved-views";
import {
  commitViewScopes,
  loadViewScope,
  saveViewScopes,
  viewScopeStorageKey,
  type ViewsStorageArea,
  type ViewScopeSnapshot
} from "../src/views-storage";

function clone<T>(value: T): T {
  return structuredClone(value);
}
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => b.localeCompare(a))
        .map(([key, item]) => [key, reorder(item)])
    );
  return value;
}

class MemoryStorage implements ViewsStorageArea {
  values: Record<string, unknown> = {};
  writes: Array<Record<string, unknown>> = [];

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) return clone(this.values);
    const list = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(
      list
        .filter((key) => Object.hasOwn(this.values, key))
        .map((key) => [key, clone(this.values[key])])
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writes.push(clone(items));
    Object.assign(this.values, clone(items));
  }
}

function legacyLayout(version: 1 | 2) {
  const entries = DEFAULT_LIFECYCLE_LAYOUT.entries
    .filter((entry) => version !== 1 || entry.type !== "option" || entry.value !== "all")
    .map((entry) =>
      entry.type === "option" && entry.value === "draft"
        ? Object.assign({}, entry, { visible: false })
        : entry
    );
  return { version, entries };
}

function changed(snapshot: ViewScopeSnapshot): ViewScopeSnapshot {
  const layout = clone(snapshot.layout);
  const first = layout.entries.find((entry) => entry.type === "view");
  if (first?.type === "view") first.visible = false;
  return { ...snapshot, layout };
}

test("existing saved built-ins retain their original query spelling when defaults change", async () => {
  const storage = new MemoryStorage();
  const key = viewScopeStorageKey("octocat/repo");
  const layout = createDefaultViewLayout();
  for (const entry of layout.entries) {
    if (entry.type === "view")
      entry.query = entry.query
        .replaceAll("state:open", "is:open")
        .replaceAll("state:closed", "is:closed");
  }
  storage.values[key] = clone(layout);
  const loaded = await loadViewScope("octocat/repo", storage);
  assert.deepEqual(loaded.layout, layout);
  assert.deepEqual(storage.values[key], layout);
  assert.deepEqual(storage.writes, []);
});

for (const version of [1, 2] as const) {
  test(`legacy v${version} layouts migrate repeatedly with order, visibility, and separators preserved`, async () => {
    const storage = new MemoryStorage();
    const legacyKey =
      version === 1
        ? "repositoryLifecycleLayout:octocat/repo"
        : "repositoryLifecycleLayout:v2:octocat/repo";
    storage.values[legacyKey] = legacyLayout(version);
    const first = await loadViewScope("octocat/repo", storage);
    const second = await loadViewScope("octocat/repo", storage);
    assert.equal(first.readOnly, false);
    assert.deepEqual(second.layout, first.layout);
    assert.deepEqual(
      first.layout.entries.filter((entry) => entry.type === "divider").map((entry) => entry.id),
      second.layout.entries.filter((entry) => entry.type === "divider").map((entry) => entry.id)
    );
    assert.equal(
      first.layout.entries.some(
        (entry) => entry.type === "view" && entry.builtin === "draft" && !entry.visible
      ),
      true
    );
    assert.deepEqual(storage.writes, []);
  });
}

test("unknown new and legacy versions are read-only and remain unchanged", async () => {
  const storage = new MemoryStorage();
  const newKey = viewScopeStorageKey("octocat/newer");
  const legacyKey = "repositoryLifecycleLayout:octocat/legacy-newer";
  const newerPrimary = { version: 42, entries: [{ future: true }] };
  const newerLegacy = { version: 42, entries: [{ future: "preserve" }] };
  storage.values[newKey] = newerPrimary;
  storage.values[legacyKey] = newerLegacy;

  const primary = await loadViewScope("octocat/newer", storage);
  const legacy = await loadViewScope("octocat/legacy-newer", storage);
  assert.equal(primary.readOnly, true);
  assert.equal(legacy.readOnly, true);
  assert.deepEqual(storage.values[newKey], newerPrimary);
  assert.deepEqual(storage.values[legacyKey], newerLegacy);
  assert.deepEqual(storage.writes, []);
  await assert.rejects(commitViewScopes([changed(primary)], storage), /preserved/);
  await assert.rejects(commitViewScopes([changed(legacy)], storage), /read-only|preserved/i);
});

test("a corrupt or null primary value takes precedence over valid legacy data", async () => {
  const storage = new MemoryStorage();
  const primaryKey = viewScopeStorageKey("octocat/repo");
  const legacyKey = "repositoryLifecycleLayout:octocat/repo";
  const legacy = legacyLayout(2);
  storage.values[primaryKey] = null;
  storage.values[legacyKey] = legacy;

  const snapshot = await loadViewScope("octocat/repo", storage);
  assert.equal(snapshot.readOnly, true);
  assert.deepEqual(storage.values[primaryKey], null);
  assert.deepEqual(storage.values[legacyKey], legacy);
});

test("moving settings between scopes commits both keys in one atomic set", async () => {
  const storage = new MemoryStorage();
  const global = await loadViewScope("global", storage);
  const repository = await loadViewScope("octocat/repo", storage);
  const updates = [changed(global), changed(repository)];
  await commitViewScopes(updates, storage);

  assert.equal(storage.writes.length, 1);
  assert.deepEqual(
    Object.keys(storage.writes[0] ?? {}).toSorted(),
    [viewScopeStorageKey("global"), viewScopeStorageKey("octocat/repo")].toSorted()
  );
});

test("stale revisions and changed legacy values are rejected", async () => {
  const storage = new MemoryStorage();
  const first = await loadViewScope("octocat/repo", storage);
  const concurrent = await loadViewScope("octocat/repo", storage);
  await commitViewScopes([changed(first)], storage);
  await assert.rejects(commitViewScopes([changed(concurrent)], storage), /changed in another tab/);

  const legacyStorage = new MemoryStorage();
  const key = "repositoryLifecycleLayout:octocat/legacy";
  legacyStorage.values[key] = legacyLayout(2);
  const legacySnapshot = await loadViewScope("octocat/legacy", legacyStorage);
  legacyStorage.values[key] = legacyLayout(1);
  await assert.rejects(
    commitViewScopes([changed(legacySnapshot)], legacyStorage),
    /changed in another tab/
  );
});

test("scope updates reject duplicate keys and invalid layouts before writing", async () => {
  const storage = new MemoryStorage();
  const snapshot = await loadViewScope("octocat/repo", storage);
  await assert.rejects(
    commitViewScopes([changed(snapshot), changed(snapshot)], storage),
    /Invalid view settings layout/
  );
  await assert.rejects(commitViewScopes([], storage), /Invalid view settings update/);
  assert.deepEqual(storage.writes, []);
});

test("saveViewScopes sends a deferred runtime message and mutates snapshots only after success", async () => {
  const snapshot = await loadViewScope("octocat/repo", new MemoryStorage());
  const update = changed(snapshot);
  let captured: unknown;
  let resolveMessage!: (value: unknown) => void;
  const previous = (globalThis as typeof globalThis & { browser?: unknown }).browser;
  (globalThis as typeof globalThis & { browser?: unknown }).browser = {
    runtime: {
      sendMessage(message: unknown) {
        captured = clone(message);
        return new Promise((resolve) => {
          resolveMessage = resolve;
        });
      }
    },
    storage: { local: {}, onChanged: { addListener() {}, removeListener() {} } }
  };
  try {
    const pending = saveViewScopes([update]);
    assert.deepEqual(captured, {
      type: "gprf:save-views",
      updates: [update]
    });
    assert.equal(update.revision, "absent");
    resolveMessage({ ok: true });
    await pending;
    assert.notEqual(update.revision, "absent");
    assert.equal(update.readOnly, false);
    assert.notEqual(update.layout, snapshot.layout);
  } finally {
    if (previous === undefined)
      delete (globalThis as typeof globalThis & { browser?: unknown }).browser;
    else (globalThis as typeof globalThis & { browser?: unknown }).browser = previous;
  }
});

test("global empty layout is available when no saved values exist", async () => {
  const snapshot = await loadViewScope("global", new MemoryStorage());
  assert.deepEqual(snapshot.layout, { version: 1, entries: [] });
  assert.deepEqual(createDefaultViewLayout().entries.length > 0, true);
});

test("consecutive saves tolerate browser storage reordering object properties", async () => {
  const storage = new MemoryStorage();
  const previous = (globalThis as typeof globalThis & { browser?: unknown }).browser;
  const update = await loadViewScope("octocat/repo", storage);
  (globalThis as typeof globalThis & { browser?: unknown }).browser = {
    storage: { local: storage },
    runtime: {
      sendMessage: async (message: { updates: ViewScopeSnapshot[] }) => {
        await commitViewScopes(message.updates, storage);
        // Chrome's storage serialization need not retain insertion order.
        storage.values = reorder(storage.values) as Record<string, unknown>;
        return { ok: true };
      }
    }
  };
  try {
    await saveViewScopes([update]);
    update.layout.entries.push({ type: "divider", id: "browser-separator" });
    await saveViewScopes([update]);
    const read = await loadViewScope("octocat/repo", storage);
    assert.equal(read.revision, update.revision);
    assert.deepEqual(read.layout, update.layout);
    assert.equal(storage.writes.length, 2);
  } finally {
    if (previous === undefined)
      delete (globalThis as typeof globalThis & { browser?: unknown }).browser;
    else (globalThis as typeof globalThis & { browser?: unknown }).browser = previous;
  }
});
