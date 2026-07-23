import { test } from "bun:test";
import * as assert from "node:assert/strict";
import {
  cloneLifecycleLayout,
  DEFAULT_LIFECYCLE_LAYOUT,
  setLifecycleVisibility,
  type LifecycleLayout
} from "../src/lifecycle-layout";
import { LIFECYCLES } from "../src/lifecycle";
import type { LifecycleActionUrls } from "../src/lifecycle-navigation";
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

function actionUrls(marker: string): LifecycleActionUrls {
  return Object.fromEntries(
    LIFECYCLES.map((lifecycle) => [
      lifecycle,
      `https://github.com/example/pulls?${marker}=${lifecycle}`
    ])
  ) as Record<(typeof LIFECYCLES)[number], string>;
}

function missingStorageListener(): never {
  throw new Error("Storage listener was not registered.");
}

test("coordinator ignores stale repository loads and clears unsupported pages", async () => {
  let snapshot: LifecyclePageSnapshot = {
    supported: true,
    repository: "octocat/first",
    selection: { kind: "preset", lifecycle: "open" },
    statePartition: "open",
    actionUrls: actionUrls("first")
  };
  const first = deferred<LifecycleLayout>();
  const second = deferred<LifecycleLayout>();
  const renders: LifecyclePageRenderState[] = [];
  let clearCount = 0;
  let suspendCount = 0;
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => snapshot,
    loadLayout: (repository) => (repository === "octocat/first" ? first.promise : second.promise),
    saveLayout: async () => undefined,
    render: (state) => renders.push(state),
    clear: () => {
      clearCount += 1;
    },
    suspend: () => {
      suspendCount += 1;
    },
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined
  });

  coordinator.start();
  assert.equal(renders.length, 1);
  assert.equal(renders.at(-1)?.repository, "octocat/first");
  snapshot = {
    ...snapshot,
    repository: "octocat/second",
    actionUrls: actionUrls("second")
  };
  coordinator.reconcile();
  assert.equal(renders.length, 2);
  assert.equal(clearCount, 0);
  assert.equal(suspendCount, 1);
  assert.equal(renders.at(-1)?.repository, "octocat/second");
  first.resolve(setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false));
  await nextTask();
  assert.equal(renders.length, 2);

  const secondLayout = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "ready", false);
  second.resolve(secondLayout);
  await nextTask();
  assert.equal(renders.length, 3);
  assert.deepEqual(renders.at(-1)?.layout, secondLayout);

  snapshot = { ...snapshot, supported: false, repository: null };
  coordinator.reconcile();
  assert.equal(clearCount, 1);
  assert.equal(suspendCount, 1);
});

test("a stale repository render cannot save its layout into the next repository", async () => {
  let snapshot: LifecyclePageSnapshot = {
    supported: true,
    repository: "octocat/first",
    selection: { kind: "preset", lifecycle: "open" },
    statePartition: "open",
    actionUrls: actionUrls("first")
  };
  const renders: LifecyclePageRenderState[] = [];
  const saves: Array<{ repository: string; layout: LifecycleLayout }> = [];
  let suspendCount = 0;
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => snapshot,
    loadLayout: async () => cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT),
    saveLayout: async (repository, layout) => {
      saves.push({ repository, layout });
    },
    render: (state) => renders.push(state),
    clear: () => undefined,
    suspend: () => {
      suspendCount += 1;
    },
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined
  });

  coordinator.start();
  await nextTask();
  const staleApply = renders.at(-1)?.applyLayout;
  assert.ok(staleApply);

  snapshot = {
    ...snapshot,
    repository: "octocat/second",
    actionUrls: actionUrls("second")
  };
  coordinator.reconcile();
  await nextTask();
  assert.equal(suspendCount, 1);
  assert.equal(renders.at(-1)?.repository, "octocat/second");

  staleApply(setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false));
  await nextTask();
  assert.deepEqual(saves, []);

  const secondLayout = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "ready", false);
  renders.at(-1)?.applyLayout(secondLayout);
  await nextTask();
  assert.deepEqual(saves, [{ repository: "octocat/second", layout: secondLayout }]);
});

test("coordinator falls back to defaults when repository storage cannot be read", async () => {
  const renders: LifecyclePageRenderState[] = [];
  const errors: Array<{ message: string; error: unknown }> = [];
  const storageError = new Error("Storage unavailable");
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => ({
      supported: true,
      repository: "octocat/hello-world",
      selection: { kind: "preset", lifecycle: "open" },
      statePartition: "open",
      actionUrls: actionUrls("fallback")
    }),
    loadLayout: async () => {
      throw storageError;
    },
    saveLayout: async () => undefined,
    render: (state) => renders.push(state),
    suspend: () => undefined,
    clear: () => undefined,
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined,
    reportError: (message, error) => errors.push({ message, error })
  });

  coordinator.start();
  await nextTask();

  assert.equal(renders.length, 2);
  assert.deepEqual(renders.at(-1)?.layout, DEFAULT_LIFECYCLE_LAYOUT);
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
      selection: { kind: "preset", lifecycle: "open" },
      statePartition: "open",
      actionUrls: actionUrls("storage")
    }),
    loadLayout: async () => cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT),
    saveLayout: async (repository, layout) => {
      saves.push({ repository, layout });
    },
    render: (state) => renders.push(state),
    suspend: () => undefined,
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

test("older local storage echoes cannot roll back a newer optimistic layout", async () => {
  const renders: LifecyclePageRenderState[] = [];
  const writes: Array<{ layout: LifecycleLayout; resolve: () => void }> = [];
  let storageListener: (repository: string, layout: LifecycleLayout) => void =
    missingStorageListener;
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => ({
      supported: true,
      repository: "octocat/hello-world",
      selection: { kind: "preset", lifecycle: "open" },
      statePartition: "open",
      actionUrls: actionUrls("storage-echo")
    }),
    loadLayout: async () => cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT),
    saveLayout: (_repository, layout) =>
      new Promise<void>((resolve) => writes.push({ layout, resolve })),
    render: (state) => renders.push(state),
    suspend: () => undefined,
    clear: () => undefined,
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: (listener) => {
      storageListener = listener;
      return () => undefined;
    }
  });

  coordinator.start();
  await nextTask();
  const first = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false);
  const second = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "ready", false);
  renders.at(-1)?.applyLayout(first);
  renders.at(-1)?.applyLayout(second);
  assert.deepEqual(renders.at(-1)?.layout, second);
  assert.equal(writes.length, 2);

  storageListener("octocat/hello-world", first);
  assert.deepEqual(renders.at(-1)?.layout, second);
  writes[0]?.resolve();
  writes[1]?.resolve();
  await nextTask();

  const external = setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "merged", false);
  storageListener("octocat/hello-world", external);
  assert.deepEqual(renders.at(-1)?.layout, external);
});

test("coordinator adopts an atomic selection and action snapshot at the same URL", async () => {
  let snapshot: LifecyclePageSnapshot = {
    supported: true,
    repository: "octocat/hello-world",
    selection: { kind: "preset", lifecycle: "open" },
    statePartition: "open",
    actionUrls: actionUrls("open-query")
  };
  const renders: LifecyclePageRenderState[] = [];
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => snapshot,
    loadLayout: async () => cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT),
    saveLayout: async () => undefined,
    render: (state) => renders.push(state),
    suspend: () => undefined,
    clear: () => undefined,
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined
  });

  coordinator.start();
  await nextTask();
  const allUrls = actionUrls("all-query");
  snapshot = {
    ...snapshot,
    selection: { kind: "preset", lifecycle: "all" },
    statePartition: "both",
    actionUrls: allUrls
  };
  coordinator.reconcile();

  assert.deepEqual(renders.at(-1)?.selection, { kind: "preset", lifecycle: "all" });
  assert.deepEqual(renders.at(-1)?.actionUrls, allUrls);
  coordinator.destroy();
});

test("a pending repository load cannot render after the coordinator is destroyed", async () => {
  const pending = deferred<LifecycleLayout>();
  const renders: LifecyclePageRenderState[] = [];
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => ({
      supported: true,
      repository: "octocat/hello-world",
      selection: { kind: "preset", lifecycle: "open" },
      statePartition: "open",
      actionUrls: actionUrls("destroy")
    }),
    loadLayout: () => pending.promise,
    saveLayout: async () => undefined,
    render: (state) => renders.push(state),
    suspend: () => undefined,
    clear: () => undefined,
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined
  });

  coordinator.start();
  assert.equal(renders.length, 1);
  coordinator.destroy();
  pending.resolve(setLifecycleVisibility(DEFAULT_LIFECYCLE_LAYOUT, "draft", false));
  await nextTask();

  assert.equal(renders.length, 1);
});

test("snapshot failures stay suspended and recover on a later reconciliation", () => {
  const snapshotError = new Error("GitHub changed its query controls");
  const errors: Array<{ message: string; error: unknown }> = [];
  const renders: LifecyclePageRenderState[] = [];
  let suspendCount = 0;
  let snapshotFails = true;
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => {
      if (snapshotFails) {
        throw snapshotError;
      }
      return {
        supported: true,
        repository: "octocat/hello-world",
        selection: { kind: "preset", lifecycle: "open" },
        statePartition: "open",
        actionUrls: actionUrls("snapshot-recovery")
      };
    },
    loadLayout: () => new Promise(() => undefined),
    saveLayout: async () => undefined,
    render: (state) => renders.push(state),
    suspend: () => {
      suspendCount += 1;
    },
    clear: () => undefined,
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined,
    reportError: (message, error) => errors.push({ message, error })
  });

  coordinator.start();
  assert.equal(suspendCount, 1);
  assert.equal(renders.length, 0);
  assert.deepEqual(errors, [
    { message: "Could not inspect this pull request page.", error: snapshotError }
  ]);

  snapshotFails = false;
  coordinator.reconcile();
  assert.equal(renders.length, 1);
  assert.equal(renders.at(-1)?.repository, "octocat/hello-world");
  coordinator.destroy();
});

test("render failures stay suspended without stopping a later render", () => {
  const renderError = new Error("GitHub replaced the mount target");
  const errors: Array<{ message: string; error: unknown }> = [];
  const renders: LifecyclePageRenderState[] = [];
  let suspendCount = 0;
  let renderFails = true;
  const coordinator = createLifecyclePageCoordinator({
    snapshot: () => ({
      supported: true,
      repository: "octocat/hello-world",
      selection: { kind: "preset", lifecycle: "open" },
      statePartition: "open",
      actionUrls: actionUrls("render-recovery")
    }),
    loadLayout: () => new Promise(() => undefined),
    saveLayout: async () => undefined,
    render: (state) => {
      if (renderFails) {
        throw renderError;
      }
      renders.push(state);
    },
    suspend: () => {
      suspendCount += 1;
    },
    clear: () => undefined,
    subscribePageChanges: () => () => undefined,
    subscribeLayoutChanges: () => () => undefined,
    reportError: (message, error) => errors.push({ message, error })
  });

  coordinator.start();
  assert.equal(suspendCount, 1);
  assert.equal(renders.length, 0);
  assert.deepEqual(errors, [
    { message: "Could not render the pull request lifecycle control.", error: renderError }
  ]);

  renderFails = false;
  coordinator.reconcile();
  assert.equal(renders.length, 1);
  assert.equal(renders.at(-1)?.repository, "octocat/hello-world");
  coordinator.destroy();
});
