import {
  cloneLifecycleLayout,
  DEFAULT_LIFECYCLE_LAYOUT,
  type LifecycleLayout
} from "./lifecycle-layout";
import type { ActiveLifecycleSelection } from "./lifecycle";
import type { LifecycleActionUrls } from "./lifecycle-navigation";
import type { LifecycleStatePartition } from "./lifecycle-query";

type TimerHandle = number | ReturnType<typeof setTimeout>;

export interface LifecyclePageSnapshot {
  readonly supported: boolean;
  readonly repository: string | null;
  readonly selection: ActiveLifecycleSelection;
  readonly statePartition: LifecycleStatePartition;
  readonly actionUrls: LifecycleActionUrls;
}

export interface LifecyclePageRenderState {
  readonly repository: string;
  readonly selection: ActiveLifecycleSelection;
  readonly statePartition: LifecycleStatePartition;
  readonly actionUrls: LifecycleActionUrls;
  readonly layout: LifecycleLayout;
  readonly applyLayout: (layout: LifecycleLayout) => void;
}

export interface LifecyclePageCoordinatorDependencies {
  readonly snapshot: () => LifecyclePageSnapshot;
  readonly loadLayout: (repository: string) => Promise<LifecycleLayout>;
  readonly saveLayout: (repository: string, layout: LifecycleLayout) => Promise<void>;
  readonly render: (state: LifecyclePageRenderState) => void;
  readonly clear: () => void;
  readonly subscribePageChanges: (listener: () => void) => () => void;
  readonly subscribeLayoutChanges: (
    listener: (repository: string, layout: LifecycleLayout) => void
  ) => () => void;
  readonly reportError?: (message: string, error: unknown) => void;
  readonly schedule?: (callback: () => void, delay: number) => TimerHandle;
  readonly cancelSchedule?: (timer: TimerHandle) => void;
}

export interface LifecyclePageCoordinator {
  start(): void;
  reconcile(): void;
  destroy(): void;
}

function layoutsEqual(left: LifecycleLayout, right: LifecycleLayout): boolean {
  return JSON.stringify(left.entries) === JSON.stringify(right.entries);
}

export function createLifecyclePageCoordinator(
  dependencies: LifecyclePageCoordinatorDependencies
): LifecyclePageCoordinator {
  const schedule = dependencies.schedule ?? setTimeout;
  const cancelSchedule = dependencies.cancelSchedule ?? clearTimeout;
  let activeSelection: ActiveLifecycleSelection | null = null;
  let activeStatePartition: LifecycleStatePartition | null = null;
  let activeActionUrls: LifecycleActionUrls | null = null;
  let activeLayout = cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
  let activeRepository: string | null = null;
  let loadedRepository: string | null = null;
  let generation = 0;
  let scheduledTimer: TimerHandle | null = null;
  let disposePageChanges: (() => void) | null = null;
  let disposeLayoutChanges: (() => void) | null = null;
  const pendingLocalWrites = new Map<string, number>();
  let started = false;

  const render = (): void => {
    if (
      !activeSelection ||
      !activeStatePartition ||
      !activeActionUrls ||
      !activeRepository ||
      loadedRepository !== activeRepository
    ) {
      return;
    }
    const repository = activeRepository;
    dependencies.render({
      repository,
      selection: activeSelection,
      statePartition: activeStatePartition,
      actionUrls: activeActionUrls,
      layout: activeLayout,
      applyLayout: (layout) => applyLayout(repository, layout)
    });
  };

  const loadAndRender = async (repository: string, expectedGeneration: number): Promise<void> => {
    let layout: LifecycleLayout;
    try {
      layout = await dependencies.loadLayout(repository);
    } catch (error) {
      if (!started || generation !== expectedGeneration || activeRepository !== repository) {
        return;
      }
      dependencies.reportError?.("Could not load this repository's menu layout.", error);
      layout = cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
    }
    if (!started || generation !== expectedGeneration || activeRepository !== repository) {
      return;
    }
    activeLayout = cloneLifecycleLayout(layout);
    loadedRepository = repository;
    reconcile();
  };

  const applyLayout = (repository: string, layout: LifecycleLayout): void => {
    if (!started || activeRepository !== repository || loadedRepository !== repository) {
      return;
    }
    generation += 1;
    activeLayout = cloneLifecycleLayout(layout);
    render();
    pendingLocalWrites.set(repository, (pendingLocalWrites.get(repository) ?? 0) + 1);
    void dependencies
      .saveLayout(repository, activeLayout)
      .catch((error: unknown) => {
        dependencies.reportError?.("Could not save this repository's menu layout.", error);
      })
      .finally(() => {
        const remaining = (pendingLocalWrites.get(repository) ?? 1) - 1;
        if (remaining === 0) {
          pendingLocalWrites.delete(repository);
        } else {
          pendingLocalWrites.set(repository, remaining);
        }
      });
  };

  const onStoredLayout = (repository: string, layout: LifecycleLayout): void => {
    if (
      repository !== activeRepository ||
      loadedRepository !== repository ||
      (pendingLocalWrites.get(repository) ?? 0) > 0 ||
      layoutsEqual(activeLayout, layout)
    ) {
      return;
    }
    generation += 1;
    activeLayout = cloneLifecycleLayout(layout);
    render();
  };

  const scheduleReconcile = (): void => {
    if (scheduledTimer !== null) {
      cancelSchedule(scheduledTimer);
    }
    scheduledTimer = schedule(() => {
      scheduledTimer = null;
      reconcile();
    }, 60);
  };

  const reconcile = (): void => {
    const snapshot = dependencies.snapshot();
    if (!snapshot.supported || !snapshot.repository) {
      dependencies.clear();
      activeSelection = null;
      activeStatePartition = null;
      activeActionUrls = null;
      activeRepository = null;
      loadedRepository = null;
      generation += 1;
      return;
    }
    if (activeRepository !== snapshot.repository) {
      if (activeRepository !== null) {
        dependencies.clear();
      }
      generation += 1;
      activeRepository = snapshot.repository;
      loadedRepository = snapshot.repository;
      activeLayout = cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
      activeSelection = snapshot.selection;
      activeStatePartition = snapshot.statePartition;
      activeActionUrls = snapshot.actionUrls;
      render();
      void loadAndRender(snapshot.repository, generation);
      return;
    }
    if (loadedRepository !== snapshot.repository) {
      return;
    }
    // GitHub can replace or hydrate the query input without changing the URL.
    // Always adopt one complete snapshot so the label and action URLs stay atomic.
    activeSelection = snapshot.selection;
    activeStatePartition = snapshot.statePartition;
    activeActionUrls = snapshot.actionUrls;
    render();
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      disposePageChanges = dependencies.subscribePageChanges(scheduleReconcile);
      disposeLayoutChanges = dependencies.subscribeLayoutChanges(onStoredLayout);
      reconcile();
    },
    reconcile,
    destroy() {
      if (!started) {
        return;
      }
      started = false;
      generation += 1;
      if (scheduledTimer !== null) {
        cancelSchedule(scheduledTimer);
        scheduledTimer = null;
      }
      disposePageChanges?.();
      disposeLayoutChanges?.();
      disposePageChanges = null;
      disposeLayoutChanges = null;
      activeSelection = null;
      activeStatePartition = null;
      activeActionUrls = null;
      activeRepository = null;
      loadedRepository = null;
      dependencies.clear();
    }
  };
}
