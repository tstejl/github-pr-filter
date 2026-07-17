import { test } from "bun:test";
import * as assert from "node:assert/strict";
import {
  cloneLifecycleLayout,
  DEFAULT_LIFECYCLE_LAYOUT,
  setLifecycleVisibility,
  type LifecycleLayout
} from "../src/lifecycle-layout";
import {
  createLifecyclePageCoordinator,
  type LifecyclePageRenderState,
  type LifecyclePageSnapshot
} from "../src/page-coordinator";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function missingStorageListener(): never {
  throw new Error("Storage listener was not registered.");
}

test("coordinator ignores stale repository loads and clears unsupported pages", async () => {
  let snapshot: LifecyclePageSnapshot = {
    supported: true,
    repository: "octocat/first",
    url: "https://github.com/octocat/first/pulls",
    preferences: { lifecycle: "open" }
  };
  const first = deferred<LifecycleLayout>();
  const second = deferred<LifecycleLayout>();
  const renders: LifecyclePageRenderState[] = [];
  let clearCount = 0;
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => snapshot,
    loadLayout: (repository) => (repository === "octocat/first" ? first.promise : second.promise),
    saveLayout: async () => undefined,
    render: (state) => renders.push(state),
    clear: () => {
      clearCount += 1;
    },
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined
  });

  coordinator.start();
  snapshot = {
    ...snapshot,
    repository: "octocat/second",
    url: "https://github.com/octocat/second/pulls"
  };
  coordinator.reconcile();
  first.resolve(setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false));
  await nextTask();
  assert.equal(renders.length, 0);

  const secondLayout = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "ready", false);
  second.resolve(secondLayout);
  await nextTask();
  assert.equal(renders.length, 1);
  assert.deepEqual(renders[0]?.layout, secondLayout);

  snapshot = { ...snapshot, supported: false, repository: null };
  coordinator.reconcile();
  assert.equal(clearCount, 1);
});

test("coordinator falls back to defaults when repository storage cannot be read", async () => {
  const renders: LifecyclePageRenderState[] = [];
  const errors: Array<{ message: string; error: unknown }> = [];
  const storageError = new Error("Storage unavailable");
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => ({
      supported: true,
      repository: "octocat/hello-world",
      url: "https://github.com/octocat/hello-world/pulls",
      preferences: { lifecycle: "open" }
    }),
    loadLayout: async () => {
      throw storageError;
    },
    saveLayout: async () => undefined,
    render: (state) => renders.push(state),
    clear: () => undefined,
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined,
    reportError: (message, error) => errors.push({ message, error })
  });

  coordinator.start();
  await nextTask();

  assert.equal(renders.length, 1);
  assert.deepEqual(renders[0]?.layout, DEFAULT_LIFECYCLE_LAYOUT);
  assert.deepEqual(errors, [
    { message: "Could not load this repository's menu layout.", error: storageError }
  ]);
});

test("coordinator persists local edits and applies matching storage changes", async () => {
  const renders: LifecyclePageRenderState[] = [];
  const saves: Array<{ repository: string; layout: LifecycleLayout }> = [];
  let storageListener: (repository: string, layout: LifecycleLayout) => void =
    missingStorageListener;
  let pageDisposed = false;
  let storageDisposed = false;
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => ({
      supported: true,
      repository: "octocat/hello-world",
      url: "https://github.com/octocat/hello-world/pulls",
      preferences: { lifecycle: "open" }
    }),
    loadLayout: async () => cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT),
    saveLayout: async (repository, layout) => {
      saves.push({ repository, layout });
    },
    render: (state) => renders.push(state),
    clear: () => undefined,
    subscribePageChanges: () => () => {
      pageDisposed = true;
    },
    subscribeLayoutChanges: (listener) => {
      storageListener = listener;
      return () => {
        storageDisposed = true;
      };
    }
  });

  coordinator.start();
  await nextTask();
  const edited = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false);
  renders.at(-1)?.applyLayout(edited);
  await nextTask();
  assert.deepEqual(saves, [{ repository: "octocat/hello-world", layout: edited }]);

  const external = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "ready", false);
  const renderCount = renders.length;
  storageListener?.("octocat/hello-world", external);
  assert.equal(renders.length, renderCount + 1);
  assert.deepEqual(renders.at(-1)?.layout, external);

  storageListener?.("octocat/other", DEFAULT_LIFECYCLE_LAYOUT);
  assert.equal(renders.length, renderCount + 1);
  coordinator.destroy();
  assert.equal(pageDisposed, true);
  assert.equal(storageDisposed, true);
});
