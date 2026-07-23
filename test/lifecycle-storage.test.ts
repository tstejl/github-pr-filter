import * as assert from "node:assert/strict";
import { test } from "bun:test";
import {
  cloneLifecycleLayout,
  DEFAULT_LIFECYCLE_LAYOUT,
  setLifecycleVisibility
} from "../src/lifecycle-layout";
import {
  type ExtensionStorageChangeEvent,
  type ExtensionStorageChangeListener,
  type ExtensionStorageArea,
  loadRepositoryLifecycleLayout,
  parseStoredLifecycleLayout,
  saveRepositoryLifecycleLayout,
  storageKeyForRepository,
  subscribeRepositoryLifecycleLayouts
} from "../src/lifecycle-storage";

class MemoryStorage implements ExtensionStorageArea {
  readonly values: Record<string, unknown> = {};
  readonly removedKeys: string[] = [];

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: this.values[key] } : {};
  }

  async remove(key: string): Promise<void> {
    this.removedKeys.push(key);
    delete this.values[key];
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
}

function legacySevenStateEntries() {
  const entriesWithoutAll = DEFAULT_LIFECYCLE_LAYOUT.entries.filter(
    (entry) => entry.type !== "option" || entry.value !== "all"
  );
  return entriesWithoutAll.at(-1)?.type === "divider"
    ? entriesWithoutAll.slice(0, -1)
    : entriesWithoutAll;
}

test("repository layouts use isolated extension-local keys", async () => {
  const storage = new MemoryStorage();
  const hiddenDraft = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false);
  await saveRepositoryLifecycleLayout("octocat/hello-world", hiddenDraft, storage);

  assert.equal(
    storageKeyForRepository("octocat/hello-world"),
    "repositoryLifecycleLayout:octocat/hello-world"
  );
  assert.deepEqual(
    await loadRepositoryLifecycleLayout("octocat/hello-world", storage),
    hiddenDraft
  );
  assert.deepEqual(
    await loadRepositoryLifecycleLayout("octocat/another-repository", storage),
    DEFAULT_LIFECYCLE_LAYOUT
  );
});

test("repository writes are serialized so the latest layout wins", async () => {
  const writes: Array<{
    items: Record<string, unknown>;
    resolve: () => void;
  }> = [];
  const storage: ExtensionStorageArea = {
    async get() {
      return {};
    },
    async remove() {},
    set(items) {
      return new Promise<void>((resolve) => writes.push({ items, resolve }));
    }
  };
  const firstLayout = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false);
  const secondLayout = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "ready", false);

  const firstSave = saveRepositoryLifecycleLayout("octocat/hello-world", firstLayout, storage);
  const secondSave = saveRepositoryLifecycleLayout("octocat/hello-world", secondLayout, storage);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writes.length, 1);
  writes[0]?.resolve();
  await firstSave;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writes.length, 2);
  writes[1]?.resolve();
  await secondSave;

  assert.deepEqual(writes[1]?.items[storageKeyForRepository("octocat/hello-world")], secondLayout);
});

test("storage subscriptions publish repository-scoped layout changes", () => {
  class MemoryChanges implements ExtensionStorageChangeEvent {
    listener: ExtensionStorageChangeListener | null = null;

    addListener(listener: ExtensionStorageChangeListener): void {
      this.listener = listener;
    }

    removeListener(listener: ExtensionStorageChangeListener): void {
      if (this.listener === listener) {
        this.listener = null;
      }
    }
  }
  const changes = new MemoryChanges();
  const received: Array<{ repository: string; layout: unknown }> = [];
  const unsubscribe = subscribeRepositoryLifecycleLayouts(
    (repository, layout) => received.push({ repository, layout }),
    changes
  );
  const layout = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false);

  changes.listener?.(
    { "repositoryLifecycleLayout:v2:octocat/hello-world": { newValue: layout } },
    "local"
  );
  assert.deepEqual(received, []);

  changes.listener?.(
    { [storageKeyForRepository("octocat/hello-world")]: { newValue: layout } },
    "local"
  );
  assert.deepEqual(received, [{ repository: "octocat/hello-world", layout }]);
  unsubscribe();
  assert.equal(changes.listener, null);
});

test("stored layouts are cloned across the storage boundary", async () => {
  const storage = new MemoryStorage();
  const layout = cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
  await saveRepositoryLifecycleLayout("octocat/hello-world", layout, storage);
  const stored = storage.values[storageKeyForRepository("octocat/hello-world")];
  assert.notEqual(stored, layout);
  assert.deepEqual(stored, layout);
});

test("public 0.6 layouts migrate in place without losing repository customization", async () => {
  const storage = new MemoryStorage();
  const key = storageKeyForRepository("octocat/hello-world");
  const legacyEntries = legacySevenStateEntries().map((entry) =>
    entry.type === "option" && entry.value === "draft"
      ? { type: "option" as const, value: entry.value, visible: false }
      : entry
  );
  storage.values[key] = { version: 1, entries: legacyEntries };

  const migrated = await loadRepositoryLifecycleLayout("octocat/hello-world", storage);

  assert.deepEqual(migrated.entries.slice(0, legacyEntries.length), legacyEntries);
  assert.equal(migrated.entries.at(-2)?.type, "divider");
  assert.deepEqual(migrated.entries.at(-1), {
    type: "option",
    value: "all",
    visible: true
  });
  assert.equal(
    migrated.entries.some(
      (entry) => entry.type === "option" && entry.value === "draft" && !entry.visible
    ),
    true
  );
  assert.equal(migrated.version, 2);
  assert.deepEqual(storage.values[key], migrated);
  assert.deepEqual(storage.removedKeys, []);
});

test("a legacy trailing separator becomes the All section boundary", () => {
  const legacyEntries = [
    ...legacySevenStateEntries(),
    { type: "divider" as const, id: "custom-final-divider" }
  ];

  const migrated = parseStoredLifecycleLayout({ version: 1, entries: legacyEntries });

  assert.ok(migrated);
  assert.deepEqual(migrated.entries.slice(0, -1), legacyEntries);
  assert.deepEqual(migrated.entries.at(-1), {
    type: "option",
    value: "all",
    visible: true
  });
});

test("pre-release versioned storage keys migrate to the stable key", async () => {
  const storage = new MemoryStorage();
  const stableKey = storageKeyForRepository("octocat/hello-world");
  const preReleaseKey = "repositoryLifecycleLayout:v2:octocat/hello-world";
  const layout = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false);
  storage.values[preReleaseKey] = layout;

  assert.deepEqual(await loadRepositoryLifecycleLayout("octocat/hello-world", storage), layout);
  assert.deepEqual(storage.values[stableKey], layout);
  assert.equal(preReleaseKey in storage.values, false);
  assert.deepEqual(storage.removedKeys, [preReleaseKey]);
});

test("a failed in-place migration write does not discard a valid public layout", async () => {
  const storage = new MemoryStorage();
  const key = storageKeyForRepository("octocat/hello-world");
  const legacyEntries = legacySevenStateEntries();
  storage.values[key] = { version: 1, entries: legacyEntries };
  storage.set = async () => {
    throw new Error("storage quota exceeded");
  };
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...values: unknown[]) => logged.push(values);

  try {
    const migrated = await loadRepositoryLifecycleLayout("octocat/hello-world", storage);

    assert.deepEqual(migrated.entries.slice(0, legacyEntries.length), legacyEntries);
    assert.equal(migrated.entries.at(-2)?.type, "divider");
    assert.deepEqual(migrated.entries.at(-1), {
      type: "option",
      value: "all",
      visible: true
    });
    assert.equal(migrated.version, 2);
    assert.deepEqual(storage.values[key], { version: 1, entries: legacyEntries });
    assert.deepEqual(storage.removedKeys, []);
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]?.[0]), /Could not persist a migrated repository layout/u);
  } finally {
    console.error = originalConsoleError;
  }
});

test("version 2 layouts require every current lifecycle exactly once", () => {
  assert.deepEqual(parseStoredLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT), DEFAULT_LIFECYCLE_LAYOUT);

  const missingAll = {
    version: 2,
    entries: DEFAULT_LIFECYCLE_LAYOUT.entries.filter(
      (entry) => entry.type !== "option" || entry.value !== "all"
    )
  };
  assert.equal(parseStoredLifecycleLayout(missingAll), null);

  const duplicateAll = {
    version: 2,
    entries: [...DEFAULT_LIFECYCLE_LAYOUT.entries, { type: "option", value: "all", visible: true }]
  };
  assert.equal(parseStoredLifecycleLayout(duplicateAll), null);
});

test("version 1 accepts only the legacy seven-state catalog", () => {
  assert.equal(
    parseStoredLifecycleLayout({
      version: 1,
      entries: DEFAULT_LIFECYCLE_LAYOUT.entries
    }),
    null
  );
});

test("corrupted stored layouts are removed and fall back to defaults", async () => {
  const storage = new MemoryStorage();
  const key = storageKeyForRepository("octocat/hello-world");
  storage.values[key] = { version: 1, entries: [] };
  assert.deepEqual(
    await loadRepositoryLifecycleLayout("octocat/hello-world", storage),
    DEFAULT_LIFECYCLE_LAYOUT
  );
  assert.equal(key in storage.values, false);
  assert.deepEqual(storage.removedKeys, [key]);

  assert.equal(parseStoredLifecycleLayout({ version: 1, entries: [] }), null);
  assert.equal(
    parseStoredLifecycleLayout({
      version: 1,
      entries: [
        { type: "option", value: "open", visible: true },
        { type: "option", value: "open", visible: true }
      ]
    }),
    null
  );
});

test("newer stored layout versions fall back without destroying future data", async () => {
  const storage = new MemoryStorage();
  const key = storageKeyForRepository("octocat/hello-world");
  const futureLayout = { version: 3, entries: [] };
  storage.values[key] = futureLayout;

  assert.deepEqual(
    await loadRepositoryLifecycleLayout("octocat/hello-world", storage),
    DEFAULT_LIFECYCLE_LAYOUT
  );
  assert.equal(storage.values[key], futureLayout);
  assert.deepEqual(storage.removedKeys, []);

  const edited = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false);
  await assert.rejects(
    saveRepositoryLifecycleLayout("octocat/hello-world", edited, storage),
    /newer than supported version/u
  );
  assert.equal(storage.values[key], futureLayout);
  assert.equal("repositoryLifecycleLayout:v2:octocat/hello-world" in storage.values, false);
});

test("a corrupted-layout cleanup failure still returns defaults", async () => {
  const storage = new MemoryStorage();
  const key = storageKeyForRepository("octocat/hello-world");
  storage.values[key] = { version: 2, entries: [] };
  storage.remove = async () => {
    throw new Error("storage unavailable");
  };
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...values: unknown[]) => logged.push(values);

  try {
    assert.deepEqual(
      await loadRepositoryLifecycleLayout("octocat/hello-world", storage),
      DEFAULT_LIFECYCLE_LAYOUT
    );
    assert.deepEqual(storage.values[key], { version: 2, entries: [] });
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]?.[0]), /Could not remove a corrupted repository layout/u);
  } finally {
    console.error = originalConsoleError;
  }
});
