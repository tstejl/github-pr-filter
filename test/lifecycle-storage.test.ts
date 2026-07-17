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

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: this.values[key] } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
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

test("invalid or obsolete stored layouts fall back to defaults", async () => {
  const storage = new MemoryStorage();
  const key = storageKeyForRepository("octocat/hello-world");
  storage.values[key] = { version: 2, entries: [] };
  assert.deepEqual(
    await loadRepositoryLifecycleLayout("octocat/hello-world", storage),
    DEFAULT_LIFECYCLE_LAYOUT
  );

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
