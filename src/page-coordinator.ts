import {
  cloneLifecycleLayout,
  DEFAULT_LIFECYCLE_LAYOUT,
  type LifecycleLayout
} from "./lifecycle-layout";
import type { LifecyclePreferences } from "./lifecycle-options";

type TimerHandle = number | ReturnType<typeof setTimeout>;

export interface LifecyclePageSnapshot {
  readonly supported: boolean;
  readonly repository: string | null;
  readonly url: string;
  readonly preferences: LifecyclePreferences;
}

export interface LifecyclePageRenderState {
  readonly preferences: LifecyclePreferences;
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
  let activePreferences: LifecyclePreferences | null = null;
  let activeLayout = cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
  let activeRepository: string | null = null;
  let loadedRepository: string | null = null;
  let lastReconciledUrl: string | null = null;
  let scheduledTimer: TimerHandle | null = null;
  let disposePageChanges: (() => void) | null = null;
  let disposeLayoutChanges: (() => void) | null = null;
  let started = false;

  const render = (): void => {
    if (!activePreferences || !activeRepository || loadedRepository !== activeRepository) {
      return;
    }
    dependencies.render({
      preferences: activePreferences,
      layout: activeLayout,
      applyLayout
    });
  };

  const loadAndRender = async (repository: string): Promise<void> => {
    let layout: LifecycleLayout;
    try {
      layout = await dependencies.loadLayout(repository);
    } catch (error) {
      dependencies.reportError?.("Could not load this repository's menu layout.", error);
      layout = cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
    }
    if (activeRepository !== repository) {
      return;
    }
    activeLayout = cloneLifecycleLayout(layout);
    loadedRepository = repository;
    lastReconciledUrl = null;
    reconcile();
  };

  const applyLayout = (layout: LifecycleLayout): void => {
    activeLayout = cloneLifecycleLayout(layout);
    render();
    const repository = activeRepository;
    if (!repository) {
      return;
    }
    void dependencies.saveLayout(repository, activeLayout).catch((error: unknown) => {
      dependencies.reportError?.("Could not save this repository's menu layout.", error);
    });
  };

  const onStoredLayout = (repository: string, layout: LifecycleLayout): void => {
    if (
      repository !== activeRepository ||
      loadedRepository !== repository ||
      layoutsEqual(activeLayout, layout)
    ) {
      return;
    }
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
      activePreferences = null;
      activeRepository = null;
      loadedRepository = null;
      lastReconciledUrl = null;
      return;
    }
    if (activeRepository !== snapshot.repository) {
      activeRepository = snapshot.repository;
      loadedRepository = null;
      activeLayout = cloneLifecycleLayout(DEFAULT_LIFECYCLE_LAYOUT);
      activePreferences = snapshot.preferences;
      void loadAndRender(snapshot.repository);
      return;
    }
    if (loadedRepository !== snapshot.repository) {
      return;
    }
    if (lastReconciledUrl !== snapshot.url) {
      activePreferences = snapshot.preferences;
      lastReconciledUrl = snapshot.url;
    }
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
      if (scheduledTimer !== null) {
        cancelSchedule(scheduledTimer);
        scheduledTimer = null;
      }
      disposePageChanges?.();
      disposeLayoutChanges?.();
      disposePageChanges = null;
      disposeLayoutChanges = null;
      dependencies.clear();
    }
  };
}
