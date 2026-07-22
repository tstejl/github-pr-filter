import {
  CONTROL_CLASS,
  createLifecycleControl,
  type LifecycleControlController
} from "./lifecycle-control";
import { createLifecycleNavigationPlan, type PullListQueryContext } from "./lifecycle-navigation";
import type { LifecycleStatePartition } from "./lifecycle-query";
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
import { analyzeLifecycleQuery } from "./lifecycle-query";
import { isRepositoryPullListPath, repositoryKeyFromPullListPath } from "./page-scope";

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

function getCurrentQueryContext(): PullListQueryContext {
  const pageUrl = location.href;
  const searchParams = new URL(pageUrl).searchParams;
  for (const parameter of ["q", "query"] as const) {
    const urlQuery = searchParams.get(parameter);
    if (urlQuery !== null) {
      return {
        pageUrl,
        input: { source: urlQuery.trim(), parameterPresent: true },
        queryParameter: parameter
      };
    }
  }
  const searchInput = getSearchInput();
  const source = searchInput?.value.trim() ?? "";
  return {
    pageUrl,
    input: { source, parameterPresent: source.length > 0 },
    queryParameter: searchInput?.name === "query" ? "query" : "q"
  };
}

function currentPageSnapshot(): LifecyclePageSnapshot {
  const repository = repositoryKeyFromPullListPath(location.pathname);
  const queryContext = getCurrentQueryContext();
  const navigation = createLifecycleNavigationPlan(queryContext);
  return {
    supported: isRepositoryPullListPath(location.pathname),
    repository,
    selection: navigation.analysis.selection,
    statePartition: navigation.analysis.statePartition,
    actionUrls: navigation.actionUrls
  };
}

type NativeCountScope = Exclude<LifecycleStatePartition, "both" | "none">;

interface NativeCount {
  readonly label: string;
  readonly value: number | null;
}

function countFromNativeLink(link: HTMLAnchorElement): NativeCount | null {
  const label = link.textContent
    .trim()
    .match(/[\p{Number}][\p{Number}\s.,]*/u)?.[0]
    .trim();
  if (!label) {
    return null;
  }
  const digits = label.replace(/[^0-9]/g, "");
  return { label, value: digits ? Number.parseInt(digits, 10) : null };
}

function nativeCount(group: HTMLElement, statePartition: LifecycleStatePartition): string | null {
  const links = [...group.querySelectorAll<HTMLAnchorElement>(":scope > a.btn-link")];
  const selectedLink = links.find(
    (link) => link.classList.contains("selected") || link.hasAttribute("aria-current")
  );
  if (selectedLink) {
    return countFromNativeLink(selectedLink)?.label ?? null;
  }

  const counts = new Map<NativeCountScope, NativeCount>();
  for (const link of links) {
    const url = new URL(link.href, location.href);
    const queryParameter = url.searchParams.has("q")
      ? "q"
      : url.searchParams.has("query")
        ? "query"
        : null;
    const query = queryParameter === null ? "" : (url.searchParams.get(queryParameter) ?? "");
    const linkPartition = analyzeLifecycleQuery({
      source: query,
      parameterPresent: queryParameter !== null
    }).statePartition;
    if (linkPartition !== "open" && linkPartition !== "closed") {
      continue;
    }
    const count = countFromNativeLink(link);
    if (count) {
      counts.set(linkPartition, count);
    }
  }

  if (statePartition === "both") {
    const open = counts.get("open")?.value;
    const closed = counts.get("closed")?.value;
    if (open === undefined || open === null || closed === undefined || closed === null) {
      return null;
    }
    return new Intl.NumberFormat(document.documentElement.lang || undefined).format(open + closed);
  }

  return statePartition === "none" ? null : (counts.get(statePartition)?.label ?? null);
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

function removeControlElement(element: HTMLDetailsElement): void {
  const controller = controls.get(element);
  controller?.destroy();
  controls.delete(element);
  element.remove();
}

function removeControlsExcept(keep: (element: HTMLDetailsElement) => boolean): void {
  for (const element of document.querySelectorAll<HTMLDetailsElement>(`.${CONTROL_CLASS}`)) {
    if (!keep(element)) {
      removeControlElement(element);
    }
  }
}

function restoreNativeStatusLinksOutside(groups: ReadonlySet<HTMLElement>): void {
  for (const link of document.querySelectorAll<HTMLElement>(".gprf-native-status-hidden")) {
    const group = link.closest<HTMLElement>(".table-list-header-toggle.states");
    if (!group || !groups.has(group)) {
      link.classList.remove("gprf-native-status-hidden");
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
    selection: state.selection,
    standalone,
    count,
    hrefForLifecycle: (lifecycle) => state.actionUrls[lifecycle],
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
    selection: state.selection,
    count,
    hrefForLifecycle: (lifecycle) => state.actionUrls[lifecycle],
    layout: state.layout,
    ...(turboFrame !== undefined ? { turboFrame } : {})
  });
}

function renderPage(state: LifecyclePageRenderState): void {
  pruneControls();
  const groups = [...document.querySelectorAll<HTMLElement>(".table-list-header-toggle.states")];
  if (groups.length > 0) {
    const currentGroups = new Set(groups);
    removeControlsExcept((element) =>
      element.parentElement ? currentGroups.has(element.parentElement) : false
    );
    restoreNativeStatusLinksOutside(currentGroups);
    for (const group of groups) {
      const count = nativeCount(group, state.statePartition);
      const turboFrame = turboFrameForGroup(group);
      const directControls = [
        ...group.querySelectorAll<HTMLDetailsElement>(`:scope > .${CONTROL_CLASS}`)
      ];
      const existingElement =
        directControls.find((element) => controls.has(element)) ?? directControls[0] ?? null;
      for (const duplicate of directControls) {
        if (duplicate !== existingElement) {
          removeControlElement(duplicate);
        }
      }
      const existingController = existingElement ? controls.get(existingElement) : undefined;
      for (const nativeLink of group.querySelectorAll<HTMLElement>(":scope > a.btn-link")) {
        nativeLink.classList.add("gprf-native-status-hidden");
      }
      if (existingController) {
        refreshControl(existingController, state, count, turboFrame);
        continue;
      }
      existingElement?.remove();
      group.append(createControl(state, false, count, turboFrame).element);
    }
    return;
  }

  restoreNativeStatusLinksOutside(new Set());
  const searchInput = getSearchInput();
  const searchContainer = searchInput?.closest<HTMLElement>("form, [role='search'], search");
  if (!searchContainer) {
    removeControlsExcept(() => false);
    return;
  }
  removeControlsExcept(
    (element) =>
      element.classList.contains("gprf-lifecycle--standalone") &&
      element.previousElementSibling === searchContainer
  );
  const existingElement = searchContainer.nextElementSibling?.matches(
    `.${CONTROL_CLASS}.gprf-lifecycle--standalone`
  )
    ? (searchContainer.nextElementSibling as HTMLDetailsElement)
    : null;
  const existingController = existingElement ? controls.get(existingElement) : undefined;
  if (existingController) {
    refreshControl(existingController, state);
    return;
  }
  existingElement?.remove();
  searchContainer.insertAdjacentElement("afterend", createControl(state, true).element);
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
