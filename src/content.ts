import {
  CONTROL_CLASS,
  createLifecycleControl,
  type LifecycleControlController
} from "./lifecycle-control";
import type { Lifecycle } from "./lifecycle-options";
import {
  createLifecyclePageCoordinator,
  type LifecyclePageRenderState,
  type LifecyclePageSnapshot
} from "./page-coordinator";
import {
  loadRepositoryLifecycleLayout,
  saveRepositoryLifecycleLayout,
  subscribeRepositoryLifecycleLayouts
} from "./lifecycle-storage";
import { isRepositoryPullListPath, repositoryKeyFromPullListPath } from "./page-scope";
import { inspectQuery, queryWithLifecycle, reconcileQuery } from "./query-state";

const controls = new Map<HTMLDetailsElement, LifecycleControlController>();

function getSearchInput(): HTMLInputElement | null {
  const selectors = [
    'input[aria-label="Search all issues"]',
    'main input[aria-label*="Search pull requests" i]',
    'main input[placeholder*="Search pull requests" i]',
    'input[name="q"][type="search"]',
    'main input[name="query"][type="search"]',
    'input[name="q"]'
  ];

  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input instanceof HTMLInputElement) {
      return input;
    }
  }
  return null;
}

function getCurrentQuery(): string {
  const searchParams = new URL(location.href).searchParams;
  for (const parameter of ["q", "query"]) {
    const urlQuery = searchParams.get(parameter);
    if (urlQuery !== null) {
      return urlQuery.trim();
    }
  }
  return getSearchInput()?.value.trim() ?? "";
}

function urlForQuery(query: string): URL {
  const url = new URL(location.href);
  const normalizedQuery = query.trim();
  const inputName = getSearchInput()?.name;
  const queryParameter = url.searchParams.has("query") || inputName === "query" ? "query" : "q";
  const unusedParameter = queryParameter === "q" ? "query" : "q";

  if (normalizedQuery) {
    url.searchParams.set(queryParameter, normalizedQuery);
  } else {
    url.searchParams.delete(queryParameter);
  }
  url.searchParams.delete(unusedParameter);
  url.searchParams.delete("page");
  return url;
}

function hrefForLifecycle(lifecycle: Lifecycle): string {
  return urlForQuery(queryWithLifecycle(getCurrentQuery(), lifecycle)).href;
}

function currentPageSnapshot(): LifecyclePageSnapshot {
  const repository = repositoryKeyFromPullListPath(location.pathname);
  return {
    supported: isRepositoryPullListPath(location.pathname),
    repository,
    url: location.href,
    preferences: reconcileQuery(getCurrentQuery()).effective
  };
}

function lifecycleFamily(lifecycle: Lifecycle): "open" | "closed" {
  return ["closed", "merged", "closed_unmerged"].includes(lifecycle) ? "closed" : "open";
}

function nativeCountForLifecycle(group: HTMLElement, lifecycle: Lifecycle): string | null {
  const desiredFamily = lifecycleFamily(lifecycle);
  for (const link of group.querySelectorAll<HTMLAnchorElement>(":scope > a.btn-link")) {
    const url = new URL(link.href, location.href);
    const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const nativeLifecycle = inspectQuery(query).lifecycle;
    if (!nativeLifecycle || lifecycleFamily(nativeLifecycle) !== desiredFamily) {
      continue;
    }
    const count = link.textContent
      .trim()
      .match(/[\p{Number}][\p{Number}\s.,]*/u)?.[0]
      .trim();
    if (count) {
      return count;
    }
  }
  return null;
}

function turboFrameForGroup(group: HTMLElement): string | null {
  return (
    group
      .querySelector<HTMLAnchorElement>(":scope > a[data-turbo-frame]")
      ?.getAttribute("data-turbo-frame") ?? null
  );
}

function pruneControls(): void {
  for (const [element, controller] of controls) {
    if (!element.isConnected) {
      controller.destroy();
      controls.delete(element);
    }
  }
}

function createControl(
  state: LifecyclePageRenderState,
  standalone = false,
  count: string | null = null,
  turboFrame: string | null = null
): LifecycleControlController {
  const controller = createLifecycleControl({
    preferences: state.preferences,
    standalone,
    count,
    hrefForLifecycle,
    customizable: true,
    layout: state.layout,
    onApplyLayout: state.applyLayout,
    turboFrame
  });
  controls.set(controller.element, controller);
  return controller;
}

function refreshControl(
  controller: LifecycleControlController,
  state: LifecyclePageRenderState,
  count: string | null = null,
  turboFrame?: string | null
): void {
  controller.refresh({
    preferences: state.preferences,
    count,
    hrefForLifecycle,
    layout: state.layout,
    ...(turboFrame !== undefined ? { turboFrame } : {})
  });
}

function renderPage(state: LifecyclePageRenderState): void {
  pruneControls();
  const groups = [...document.querySelectorAll<HTMLElement>(".table-list-header-toggle.states")];
  if (groups.length > 0) {
    for (const group of groups) {
      const count = nativeCountForLifecycle(group, state.preferences.lifecycle);
      const turboFrame = turboFrameForGroup(group);
      const existingElement = group.querySelector<HTMLDetailsElement>(`:scope > .${CONTROL_CLASS}`);
      const existingController = existingElement ? controls.get(existingElement) : undefined;
      if (existingController) {
        refreshControl(existingController, state, count, turboFrame);
        continue;
      }
      existingElement?.remove();
      for (const nativeLink of group.querySelectorAll<HTMLElement>(":scope > a.btn-link")) {
        nativeLink.classList.add("gprf-native-status-hidden");
      }
      group.append(createControl(state, false, count, turboFrame).element);
    }
    return;
  }

  const existingElement = document.querySelector<HTMLDetailsElement>(`.${CONTROL_CLASS}`);
  const existingController = existingElement ? controls.get(existingElement) : undefined;
  if (existingController) {
    refreshControl(existingController, state);
    return;
  }
  existingElement?.remove();
  const searchInput = getSearchInput();
  const searchContainer = searchInput?.closest("form, [role='search'], search");
  if (searchContainer) {
    searchContainer.insertAdjacentElement("afterend", createControl(state, true).element);
  }
}

function clearPage(): void {
  for (const controller of controls.values()) {
    controller.destroy();
  }
  controls.clear();
  document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => control.remove());
  document.querySelectorAll(".gprf-native-status-hidden").forEach((link) => {
    link.classList.remove("gprf-native-status-hidden");
  });
}

function closeOpenMenus(event: MouseEvent): void {
  const eventPath = event.composedPath();
  for (const control of document.querySelectorAll<HTMLDetailsElement>(`.${CONTROL_CLASS}[open]`)) {
    if (
      !eventPath.includes(control) &&
      !control.classList.contains("gprf-lifecycle--configuring")
    ) {
      control.removeAttribute("open");
    }
  }
}

function subscribePageChanges(listener: () => void): () => void {
  const observer = new MutationObserver((mutations) => {
    const pageChanged = mutations.some(
      ({ target }) => !(target instanceof Element && target.closest(`.${CONTROL_CLASS}`))
    );
    if (pageChanged) {
      listener();
    }
  });
  document.addEventListener("click", closeOpenMenus);
  window.addEventListener("popstate", listener);
  document.addEventListener("turbo:load", listener);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    document.removeEventListener("click", closeOpenMenus);
    window.removeEventListener("popstate", listener);
    document.removeEventListener("turbo:load", listener);
  };
}

const coordinator = createLifecyclePageCoordinator({
  snapshot: currentPageSnapshot,
  loadLayout: loadRepositoryLifecycleLayout,
  saveLayout: saveRepositoryLifecycleLayout,
  render: renderPage,
  clear: clearPage,
  subscribePageChanges,
  subscribeLayoutChanges: subscribeRepositoryLifecycleLayouts,
  reportError: (message, error) => console.error(`GitHub PR Filter: ${message}`, error)
});

coordinator.start();
