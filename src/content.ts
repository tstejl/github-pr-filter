import { createGitHubPullListAdapter } from "./github-pull-list-adapter";
import {
  loadRepositoryLifecycleLayout,
  saveRepositoryLifecycleLayout,
  subscribeRepositoryLifecycleLayouts
} from "./lifecycle-storage";
import { createLifecyclePageCoordinator } from "./page-coordinator";

const github = createGitHubPullListAdapter({ document, location, window });

const coordinator = createLifecyclePageCoordinator({
  snapshot: github.snapshot,
  loadLayout: loadRepositoryLifecycleLayout,
  saveLayout: saveRepositoryLifecycleLayout,
  render: github.render,
  suspend: github.suspend,
  clear: github.clear,
  subscribePageChanges: github.subscribePageChanges,
  subscribeLayoutChanges: subscribeRepositoryLifecycleLayouts,
  reportError: (message, error) => console.error(`GitHub PR Filter: ${message}`, error)
});

coordinator.start();
