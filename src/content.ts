import { createGitHubPullListAdapter } from "./github-pull-list-adapter";
import {
  loadRepositoryLifecycleLayout,
  saveRepositoryLifecycleLayout,
  subscribeRepositoryLifecycleLayouts
} from "./lifecycle-storage";
import { createLifecyclePageCoordinator } from "./page-coordinator";

const github = createGitHubPullListAdapter({ document, location, window });

const coordinator = createLifecyclePageCoordinator({
  snapshot: () => github.snapshot(),
  loadLayout: loadRepositoryLifecycleLayout,
  saveLayout: saveRepositoryLifecycleLayout,
  render: (state) => github.render(state),
  suspend: () => github.suspend(),
  clear: () => github.clear(),
  subscribePageChanges: (listener) => github.subscribePageChanges(listener),
  subscribeLayoutChanges: subscribeRepositoryLifecycleLayouts,
  reportError: (message, error) => console.error(`GitHub PR Filter: ${message}`, error)
});

coordinator.start();
