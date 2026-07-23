import {
  CONTROL_CLASS,
  createLifecycleControl,
  type LifecycleControlController
} from "./lifecycle-control";
import { createLifecycleNavigationPlan } from "./lifecycle-navigation";
import type { LifecycleStatePartition } from "./lifecycle-query";
import type { LifecyclePageRenderState, LifecyclePageSnapshot } from "./page-coordinator";
import { clearPageMarkers, markReplacementMounted, markReplacementPending } from "./page-markers";
import { isRepositoryPullListPath, repositoryKeyFromPullListPath } from "./page-scope";
import {
  createCommittedQueryContext,
  hasRecognizableNativeStatusLinks,
  resolveNativeStatusCount,
  selectSearchField,
  selectStatusGroups,
  type CommittedSearchField,
  type NativeStatusLink
} from "./github-pull-list-contract";

const STATUS_GROUP_SELECTOR = ".table-list-header-toggle.states";
const HIDDEN_NATIVE_STATUS_CLASS = "gprf-native-status-hidden";
const URL_CHECK_INTERVAL_MS = 500;

const SEARCH_INPUT_SELECTORS = Object.freeze([
  'main input[aria-label*="Search pull requests" i]',
  'main input[placeholder*="Search pull requests" i]',
  'main input[aria-label="Search all issues"]',
  'main input[name="q"][type="search"]',
  'main input[name="query"][type="search"]',
  'input[aria-label*="Search pull requests" i]',
  'input[placeholder*="Search pull requests" i]',
  'input[aria-label="Search all issues"]',
  'input[name="q"][type="search"]',
  'input[name="query"][type="search"]',
  'input[name="q"]'
]);
const SEARCH_INPUT_SELECTOR = SEARCH_INPUT_SELECTORS.join(",");

export interface GitHubPullListAdapter {
  snapshot(): LifecyclePageSnapshot;
  render(state: LifecyclePageRenderState): void;
  suspend(): void;
  clear(): void;
  subscribePageChanges(listener: () => void): () => void;
}

interface GitHubPullListAdapterEnvironment {
  readonly document: Document;
  readonly location: Location;
  readonly window: Window & typeof globalThis;
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

function nativeLinksForGroup(group: HTMLElement): readonly HTMLAnchorElement[] {
  return [...group.querySelectorAll<HTMLAnchorElement>(":scope > a.btn-link")];
}

function nativeStatusLinksForGroup(group: HTMLElement): readonly NativeStatusLink[] {
  return nativeLinksForGroup(group).map((link) => ({
    href: link.href,
    text: link.textContent,
    selected: link.classList.contains("selected") || link.hasAttribute("aria-current")
  }));
}

function turboFrameForGroup(group: HTMLElement): string | null {
  return (
    group
      .querySelector<HTMLAnchorElement>(":scope > a[data-turbo-frame]")
      ?.getAttribute("data-turbo-frame") ?? null
  );
}

export function createGitHubPullListAdapter(
  environment: GitHubPullListAdapterEnvironment
): GitHubPullListAdapter {
  const { document, location, window } = environment;
  const controls = new Map<HTMLDetailsElement, LifecycleControlController>();

  const isVisibleSearchInput = (input: HTMLInputElement): boolean => {
    if (input.hidden || input.type === "hidden") {
      return false;
    }
    const style = window.getComputedStyle(input);
    return (
      style.display !== "none" && style.visibility !== "hidden" && input.getClientRects().length > 0
    );
  };

  const belongsToCurrentPullList = (input: HTMLInputElement): boolean => {
    if (input.name !== "q" && input.name !== "query") {
      return false;
    }
    const form = input.closest("form");
    if (!form) {
      return false;
    }
    try {
      const action = new URL(form.getAttribute("action") || location.href, location.href);
      const currentRepository = repositoryKeyFromPullListPath(location.pathname);
      return (
        currentRepository !== null &&
        repositoryKeyFromPullListPath(action.pathname) === currentRepository
      );
    } catch {
      return false;
    }
  };

  const searchInput = (): HTMLInputElement | null => {
    const candidates = [...document.querySelectorAll(SEARCH_INPUT_SELECTOR)]
      .filter(
        (candidate): candidate is HTMLInputElement => candidate instanceof window.HTMLInputElement
      )
      .map((input) => ({
        value: input,
        connected: input.isConnected,
        withinMain: input.closest("main") !== null,
        visible: isVisibleSearchInput(input),
        pullListForm: belongsToCurrentPullList(input)
      }));
    return selectSearchField(candidates);
  };

  const committedSearchField = (): CommittedSearchField | null => {
    const input = searchInput();
    return input
      ? {
          name: input.name,
          // `value` includes unsubmitted typing. `defaultValue` is the
          // server-rendered query committed by GitHub.
          committedValue: input.defaultValue
        }
      : null;
  };

  const statusGroups = (): readonly HTMLElement[] => {
    const candidates = [...document.querySelectorAll<HTMLElement>(STATUS_GROUP_SELECTOR)].map(
      (group) => ({
        value: group,
        connected: group.isConnected,
        withinMain: group.closest("main") !== null,
        capable: hasRecognizableNativeStatusLinks(nativeStatusLinksForGroup(group), location.href)
      })
    );
    return selectStatusGroups(candidates);
  };

  const pruneControls = (): void => {
    for (const [element, controller] of controls) {
      if (!element.isConnected) {
        controller.destroy();
        controls.delete(element);
      }
    }
  };

  const removeControlElement = (element: HTMLDetailsElement): void => {
    controls.get(element)?.destroy();
    controls.delete(element);
    element.remove();
  };

  const removeControlsExcept = (keep: (element: HTMLDetailsElement) => boolean): void => {
    for (const element of document.querySelectorAll<HTMLDetailsElement>(`.${CONTROL_CLASS}`)) {
      if (!keep(element)) {
        removeControlElement(element);
      }
    }
  };

  const restoreNativeStatusLinksOutside = (groups: ReadonlySet<HTMLElement>): void => {
    for (const link of document.querySelectorAll<HTMLElement>(`.${HIDDEN_NATIVE_STATUS_CLASS}`)) {
      const group = link.closest<HTMLElement>(STATUS_GROUP_SELECTOR);
      if (!group || !groups.has(group)) {
        link.classList.remove(HIDDEN_NATIVE_STATUS_CLASS);
      }
    }
  };

  const createControl = (
    state: LifecyclePageRenderState,
    standalone = false,
    count: string | null = null,
    turboFrame: string | null = null
  ): LifecycleControlController => {
    const controller = createLifecycleControl({
      selection: state.selection,
      standalone,
      count,
      hrefForLifecycle: (lifecycle) => state.actionUrls[lifecycle],
      customizable: true,
      layout: state.layout,
      onApplyLayout: state.applyLayout,
      turboFrame,
      ownerDocument: document
    });
    controls.set(controller.element, controller);
    return controller;
  };

  const nativeCount = (
    group: HTMLElement,
    statePartition: LifecycleStatePartition
  ): string | null => {
    return resolveNativeStatusCount(
      nativeStatusLinksForGroup(group),
      statePartition,
      location.href,
      document.documentElement.lang
    );
  };

  const resetReplacement = (): void => {
    for (const controller of controls.values()) {
      controller.destroy();
    }
    controls.clear();
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => control.remove());
    document.querySelectorAll(`.${HIDDEN_NATIVE_STATUS_CLASS}`).forEach((link) => {
      link.classList.remove(HIDDEN_NATIVE_STATUS_CLASS);
    });
  };

  const suspend = (): void => {
    resetReplacement();
    markReplacementPending(document.documentElement);
  };

  const clear = (): void => {
    resetReplacement();
    clearPageMarkers(document.documentElement);
  };

  const render = (state: LifecyclePageRenderState): void => {
    pruneControls();
    const groups = statusGroups();
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
        for (const nativeLink of nativeLinksForGroup(group)) {
          nativeLink.classList.add(HIDDEN_NATIVE_STATUS_CLASS);
        }
        if (existingController) {
          refreshControl(existingController, state, count, turboFrame);
          continue;
        }
        existingElement?.remove();
        group.append(createControl(state, false, count, turboFrame).element);
      }

      markReplacementMounted(document.documentElement);
      return;
    }

    restoreNativeStatusLinksOutside(new Set());
    const searchContainer = searchInput()?.closest<HTMLElement>("form, [role='search'], search");
    if (!searchContainer) {
      suspend();
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
      markReplacementMounted(document.documentElement);
      return;
    }
    existingElement?.remove();
    searchContainer.insertAdjacentElement("afterend", createControl(state, true).element);
    markReplacementMounted(document.documentElement);
  };

  const snapshot = (): LifecyclePageSnapshot => {
    const queryContext = createCommittedQueryContext(location.href, committedSearchField());
    const navigation = createLifecycleNavigationPlan(queryContext);
    return {
      supported: isRepositoryPullListPath(location.pathname),
      repository: repositoryKeyFromPullListPath(location.pathname),
      selection: navigation.analysis.selection,
      statePartition: navigation.analysis.statePartition,
      actionUrls: navigation.actionUrls
    };
  };

  const closeOpenMenus = (event: MouseEvent): void => {
    const eventPath = event.composedPath();
    for (const control of document.querySelectorAll<HTMLDetailsElement>(
      `.${CONTROL_CLASS}[open]`
    )) {
      if (
        !eventPath.includes(control) &&
        !control.classList.contains("gprf-lifecycle--configuring")
      ) {
        control.removeAttribute("open");
      }
    }
  };

  const isExtensionOnlyMutation = (mutation: MutationRecord): boolean => {
    if (mutation.target instanceof window.Element && mutation.target.closest(`.${CONTROL_CLASS}`)) {
      return true;
    }
    return (
      mutation.type === "childList" &&
      mutation.removedNodes.length === 0 &&
      mutation.addedNodes.length > 0 &&
      [...mutation.addedNodes].every(
        (node) => node instanceof window.Element && node.matches(`.${CONTROL_CLASS}`)
      )
    );
  };

  const touchesGitHubPullListContract = (element: Element): boolean =>
    element.matches(STATUS_GROUP_SELECTOR) ||
    element.matches(SEARCH_INPUT_SELECTOR) ||
    element.querySelector(`${STATUS_GROUP_SELECTOR},${SEARCH_INPUT_SELECTOR}`) !== null;

  const isRelevantPageMutation = (mutation: MutationRecord): boolean => {
    if (isExtensionOnlyMutation(mutation)) {
      return false;
    }
    if (
      mutation.type === "attributes" &&
      mutation.target instanceof window.Element &&
      touchesGitHubPullListContract(mutation.target)
    ) {
      return true;
    }
    if (
      mutation.target instanceof window.Element &&
      mutation.target.closest(STATUS_GROUP_SELECTOR)
    ) {
      return true;
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) => node instanceof window.Element && touchesGitHubPullListContract(node)
    );
  };

  const subscribePageChanges = (listener: () => void): (() => void) => {
    let observedHref = location.href;
    let observingPullList = false;
    let observer: MutationObserver | null = null;
    const syncObserverScope = (): void => {
      const shouldObserve = isRepositoryPullListPath(location.pathname);
      if (shouldObserve === observingPullList || observer === null) {
        return;
      }
      observer.disconnect();
      observingPullList = shouldObserve;
      if (shouldObserve) {
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["action", "name", "value"],
          childList: true,
          subtree: true
        });
      }
    };
    const notifyPageChange = (): void => {
      observedHref = location.href;
      if (isRepositoryPullListPath(location.pathname)) {
        markReplacementPending(document.documentElement);
      }
      syncObserverScope();
      listener();
    };
    observer = new window.MutationObserver((mutations) => {
      if (location.href !== observedHref || mutations.some(isRelevantPageMutation)) {
        notifyPageChange();
      }
    });
    document.addEventListener("click", closeOpenMenus);
    window.addEventListener("popstate", notifyPageChange);
    window.addEventListener("resize", notifyPageChange);
    document.addEventListener("turbo:load", notifyPageChange);
    document.addEventListener("turbo:render", notifyPageChange);
    const urlCheckTimer = window.setInterval(() => {
      if (location.href !== observedHref) {
        notifyPageChange();
      }
    }, URL_CHECK_INTERVAL_MS);
    syncObserverScope();

    return () => {
      observer?.disconnect();
      document.removeEventListener("click", closeOpenMenus);
      window.removeEventListener("popstate", notifyPageChange);
      window.removeEventListener("resize", notifyPageChange);
      document.removeEventListener("turbo:load", notifyPageChange);
      document.removeEventListener("turbo:render", notifyPageChange);
      window.clearInterval(urlCheckTimer);
    };
  };

  return { snapshot, render, suspend, clear, subscribePageChanges };
}
