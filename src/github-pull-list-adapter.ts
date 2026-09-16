import {
  HIDDEN_NATIVE_STATUS_CLASS,
  HIDDEN_NATIVE_RESULTS_CLASS,
  PREVIEW_CONTROL_CLASS,
  PREVIEW_TOOLBAR_SELECTOR,
  PREVIEW_HEADING_SELECTOR,
  PREVIEW_STATUS_CONTROL_SELECTOR,
  previewAccessibleText,
  previewLifecycleForText,
  isPreviewResultHeading,
  previewRegionForToolbar,
  previewRegions,
  refreshPreviewRegion,
  type PreviewRegion
} from "./github-preview-header";
import {
  CONTROL_CLASS,
  createLifecycleControl,
  requestLifecycleControlClose,
  type LifecycleControlController
} from "./lifecycle-control";
import { createLifecycleNavigationPlan } from "./lifecycle-navigation";
import { createIssueNavigationPlan } from "./issue-navigation";
import { ISSUE_LIFECYCLE_OPTIONS } from "./issue-options";
import { LIFECYCLE_OPTIONS } from "./lifecycle-options";
import { DEFAULT_LIFECYCLE_LAYOUT } from "./lifecycle-layout";
import type { LifecycleStatePartition } from "./lifecycle-query";
import type { LifecyclePageRenderState, LifecyclePageSnapshot } from "./page-coordinator";
import { clearPageMarkers, markReplacementMounted, markReplacementPending } from "./page-markers";
import {
  isRepositoryIssueListPath,
  isRepositoryPullListPath,
  repositoryKeyFromListPath
} from "./page-scope";
import {
  createCommittedQueryContext,
  hasRecognizableNativeStatusLinks,
  resolveNativeStatusCount,
  resolvePreviewStatusCount,
  selectSearchField,
  selectStatusGroups,
  type CommittedSearchField,
  type NativeStatusLink
} from "./github-pull-list-contract";

const STATUS_GROUP_SELECTOR = ".table-list-header-toggle.states";
const URL_CHECK_INTERVAL_MS = 500;

const SEARCH_INPUT_SELECTORS = Object.freeze([
  'main input[aria-label*="Search pull requests" i]',
  'main input[placeholder*="Search pull requests" i]',
  'main input[aria-label="Search all issues"]',
  "main #repository-input",
  'main input[name="q"][type="search"]',
  'main input[name="query"][type="search"]',
  'input[aria-label*="Search pull requests" i]',
  'input[placeholder*="Search pull requests" i]',
  'input[aria-label="Search all issues"]',
  "#repository-input",
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

type GitHubListKind = "pulls" | "issues";

interface GitHubPullListAdapterEnvironment {
  readonly document: Document;
  readonly location: Location;
  readonly window: Window & typeof globalThis;
}

function refreshControl(
  controller: LifecycleControlController,
  state: LifecyclePageRenderState,
  count: string | null = null,
  turboFrame?: string | null,
  countPending = false,
  issuePage = false
): void {
  controller.refresh({
    selection: state.selection,
    count,
    countPending,
    hrefForLifecycle: (lifecycle) => state.actionUrls[lifecycle],
    layout: issuePage ? DEFAULT_LIFECYCLE_LAYOUT : state.layout,
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

const restorePreviewNativeControlsOutside = (
  controlsToKeep: ReadonlySet<HTMLElement>,
  regions: readonly PreviewRegion[]
): void => {
  for (const region of regions) {
    for (const { element } of region.controls) {
      if (!controlsToKeep.has(element)) {
        element.classList.remove(HIDDEN_NATIVE_STATUS_CLASS);
      }
    }
  }
};

const touchesPreviewContract = (element: Element): boolean =>
  element.matches(PREVIEW_TOOLBAR_SELECTOR) ||
  element.closest(PREVIEW_TOOLBAR_SELECTOR) !== null ||
  element.querySelector(PREVIEW_TOOLBAR_SELECTOR) !== null;

const listKindForPath = (pathname: string): GitHubListKind | null => {
  if (isRepositoryIssueListPath(pathname)) {
    return "issues";
  }
  if (isRepositoryPullListPath(pathname)) {
    return "pulls";
  }
  return null;
};

export function createGitHubPullListAdapter(
  environment: GitHubPullListAdapterEnvironment
): GitHubPullListAdapter {
  const { document, location, window } = environment;
  const controls = new Map<HTMLDetailsElement, LifecycleControlController>();
  let rememberedPreviewRegions: readonly PreviewRegion[] = [];
  const previewHeadings = new Set<HTMLElement>();
  const hiddenPreviewHeadings = new Set<HTMLElement>();
  let previewHeadingFresh = true;

  const listKind = (): GitHubListKind =>
    isRepositoryIssueListPath(location.pathname) ? "issues" : "pulls";
  // Issue query/navigation support remains available for a future release, but the
  // current release mounts lifecycle controls only on pull request lists.
  const isSupportedList = (): boolean => isRepositoryPullListPath(location.pathname);

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
    if (input.name !== "q" && input.name !== "query" && input.id !== "repository-input") {
      return false;
    }
    const form = input.closest("form");
    if (!form) {
      return false;
    }
    try {
      const action = new URL(form.getAttribute("action") || location.href, location.href);
      const currentRepository = repositoryKeyFromListPath(location.pathname);
      const currentKind = listKindForPath(location.pathname);
      const actionKind = listKindForPath(action.pathname);
      return (
        currentRepository !== null &&
        currentKind !== null &&
        actionKind === currentKind &&
        repositoryKeyFromListPath(action.pathname) === currentRepository
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
    turboFrame: string | null = null,
    modifierClass: string | null = null
  ): LifecycleControlController => {
    const issuePage = listKind() === "issues";
    const controller = createLifecycleControl({
      selection: state.selection,
      standalone,
      count,
      hrefForLifecycle: (lifecycle) => state.actionUrls[lifecycle],
      options: issuePage ? ISSUE_LIFECYCLE_OPTIONS : LIFECYCLE_OPTIONS,
      customizable: !issuePage,
      subject: issuePage ? "issue" : "pull request",
      layout: issuePage ? DEFAULT_LIFECYCLE_LAYOUT : state.layout,
      onApplyLayout: state.applyLayout,
      turboFrame,
      ownerDocument: document
    });
    if (modifierClass) {
      controller.element.classList.add(modifierClass);
    }
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
    for (const heading of hiddenPreviewHeadings) {
      heading.classList.remove(HIDDEN_NATIVE_RESULTS_CLASS);
    }
    hiddenPreviewHeadings.clear();
    previewHeadings.clear();
    rememberedPreviewRegions = [];
  };

  const restorePreviewHeadingsOutside = (headingsToKeep: ReadonlySet<HTMLElement>): void => {
    for (const heading of hiddenPreviewHeadings) {
      if (!headingsToKeep.has(heading)) {
        heading.classList.remove(HIDDEN_NATIVE_RESULTS_CLASS);
        hiddenPreviewHeadings.delete(heading);
      }
    }
  };

  const clearPreviewState = (): void => {
    restorePreviewNativeControlsOutside(new Set(), rememberedPreviewRegions);
    restorePreviewHeadingsOutside(new Set());
    previewHeadings.clear();
    rememberedPreviewRegions = [];
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
      clearPreviewState();
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
          refreshControl(
            existingController,
            state,
            count,
            turboFrame,
            false,
            listKind() === "issues"
          );
          continue;
        }
        existingElement?.remove();
        group.append(createControl(state, false, count, turboFrame).element);
      }

      markReplacementMounted(document.documentElement);
      return;
    }

    const previousPreviewRegions = rememberedPreviewRegions;
    const discoveredPreviewRegions = previewRegions(document);
    const refreshedPreviewRegions = previousPreviewRegions
      .map(refreshPreviewRegion)
      .filter((region): region is PreviewRegion => region !== null);
    if (discoveredPreviewRegions.length > 0) {
      rememberedPreviewRegions = discoveredPreviewRegions;
    } else if (refreshedPreviewRegions.length > 0) {
      rememberedPreviewRegions = refreshedPreviewRegions;
    }
    const activePreviewRegions =
      discoveredPreviewRegions.length > 0 ? discoveredPreviewRegions : refreshedPreviewRegions;
    if (activePreviewRegions.length > 0) {
      const previewSlots = new Set(activePreviewRegions.map(({ slot }) => slot));
      const previewHeadingsToKeep = new Set(
        activePreviewRegions.flatMap(({ heading }) => (heading ? [heading] : []))
      );
      const previewNativeControlsToKeep = new Set(
        activePreviewRegions.flatMap((region) => region.controls.map(({ element }) => element))
      );
      restoreNativeStatusLinksOutside(new Set());
      restorePreviewNativeControlsOutside(previewNativeControlsToKeep, [
        ...previousPreviewRegions,
        ...rememberedPreviewRegions
      ]);
      restorePreviewHeadingsOutside(previewHeadingsToKeep);
      previewHeadings.clear();
      for (const heading of previewHeadingsToKeep) previewHeadings.add(heading);
      removeControlsExcept(
        (element) =>
          element.classList.contains(PREVIEW_CONTROL_CLASS) &&
          element.parentElement !== null &&
          previewSlots.has(element.parentElement)
      );

      for (const region of activePreviewRegions) {
        const count = resolvePreviewStatusCount(
          region.heading ? previewAccessibleText(region.heading) : null,
          region.controls.map(({ control }) => control),
          state.statePartition,
          document.documentElement.lang,
          previewHeadingFresh
        );
        const directControls = [
          ...region.slot.querySelectorAll<HTMLDetailsElement>(`:scope > .${CONTROL_CLASS}`)
        ];
        const existingElement =
          directControls.find((element) => controls.has(element)) ?? directControls[0] ?? null;
        for (const duplicate of directControls) {
          if (duplicate !== existingElement) {
            removeControlElement(duplicate);
          }
        }

        for (const nativeControl of region.controls) {
          nativeControl.element.classList.add(HIDDEN_NATIVE_STATUS_CLASS);
        }
        if (region.heading) {
          region.heading.classList.add(HIDDEN_NATIVE_RESULTS_CLASS);
          hiddenPreviewHeadings.add(region.heading);
        }
        const existingController = existingElement ? controls.get(existingElement) : undefined;
        if (existingController) {
          refreshControl(
            existingController,
            state,
            count,
            undefined,
            count === null,
            listKind() === "issues"
          );
          continue;
        }
        existingElement?.remove();
        const replacement = createControl(state, false, count, null, PREVIEW_CONTROL_CLASS).element;
        region.slot.insertBefore(
          replacement,
          region.anchor.parentElement === region.slot ? region.anchor : null
        );
      }
      markReplacementMounted(document.documentElement);
      return;
    }

    clearPreviewState();
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
      refreshControl(existingController, state, null, undefined, false, listKind() === "issues");
      markReplacementMounted(document.documentElement);
      return;
    }
    existingElement?.remove();
    searchContainer.insertAdjacentElement("afterend", createControl(state, true).element);
    markReplacementMounted(document.documentElement);
  };

  const snapshot = (): LifecyclePageSnapshot => {
    const queryContext = createCommittedQueryContext(location.href, committedSearchField());
    const navigation =
      listKind() === "issues"
        ? createIssueNavigationPlan(queryContext)
        : createLifecycleNavigationPlan(queryContext);
    const repository = repositoryKeyFromListPath(location.pathname);
    return {
      supported: isSupportedList(),
      repository:
        repository === null ? null : listKind() === "issues" ? `${repository}#issues` : repository,
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
        requestLifecycleControlClose(control);
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

  const mutationTargetElement = (mutation: MutationRecord): Element | null => {
    if (mutation.target instanceof window.Element) {
      return mutation.target;
    }
    return mutation.target.parentNode instanceof window.Element ? mutation.target.parentNode : null;
  };

  const isPreviewStatusElement = (element: Element): boolean => {
    if (
      !(element instanceof window.HTMLElement) ||
      !element.matches(PREVIEW_STATUS_CONTROL_SELECTOR)
    ) {
      return false;
    }
    const text = previewAccessibleText(element);
    return previewLifecycleForText(text) !== null && /\p{Number}/u.test(text);
  };

  const belongsToPreviewRegion = (element: Element): boolean => {
    if (rememberedPreviewRegions.some(({ root }) => root.contains(element))) {
      return true;
    }
    return [...document.querySelectorAll<HTMLElement>(PREVIEW_TOOLBAR_SELECTOR)].some((toolbar) =>
      previewRegionForToolbar(toolbar)?.root.contains(element)
    );
  };

  const touchesPreviewContent = (mutation: MutationRecord): boolean => {
    // Selection and destination changes do not establish that counts are current.
    if (mutation.type === "attributes" && mutation.attributeName !== "aria-label") return false;
    const target = mutationTargetElement(mutation);
    if (target) {
      const heading = target.closest<HTMLElement>(PREVIEW_HEADING_SELECTOR);
      if (
        heading &&
        (previewHeadings.has(heading) ||
          (isPreviewResultHeading(heading) && belongsToPreviewRegion(heading)))
      ) {
        return true;
      }
      for (const region of rememberedPreviewRegions) {
        if (region.controls.some(({ element }) => element === target || element.contains(target))) {
          return true;
        }
      }
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) =>
        node instanceof window.HTMLElement &&
        (previewHeadings.has(node) ||
          rememberedPreviewRegions.some(({ controls: nativeControls }) =>
            nativeControls.some(({ element }) => element === node)
          ) ||
          (isPreviewResultHeading(node) && belongsToPreviewRegion(node)) ||
          (isPreviewStatusElement(node) && belongsToPreviewRegion(node)) ||
          [...node.querySelectorAll<HTMLElement>(PREVIEW_HEADING_SELECTOR)].some(
            (heading) => isPreviewResultHeading(heading) && belongsToPreviewRegion(heading)
          ) ||
          [...node.querySelectorAll<HTMLElement>(PREVIEW_STATUS_CONTROL_SELECTOR)].some(
            (control) => isPreviewStatusElement(control) && belongsToPreviewRegion(control)
          ))
    );
  };

  const isRelevantPageMutation = (mutation: MutationRecord): boolean => {
    if (isExtensionOnlyMutation(mutation)) {
      return false;
    }
    if (
      mutation.type === "attributes" &&
      mutationTargetElement(mutation) !== null &&
      touchesGitHubPullListContract(mutationTargetElement(mutation) as Element)
    ) {
      return true;
    }
    const target = mutationTargetElement(mutation);
    if (target?.closest(STATUS_GROUP_SELECTOR) || (target && touchesPreviewContract(target))) {
      return true;
    }
    return (
      touchesPreviewContent(mutation) ||
      [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) => node instanceof window.Element && touchesGitHubPullListContract(node)
      )
    );
  };

  const subscribePageChanges = (listener: () => void): (() => void) => {
    let observedHref = location.href;
    let observingPullList = false;
    let observer: MutationObserver | null = null;
    const syncObserverScope = (): void => {
      const shouldObserve = isSupportedList();
      if (shouldObserve === observingPullList || observer === null) {
        return;
      }
      observer.disconnect();
      observingPullList = shouldObserve;
      if (shouldObserve) {
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: [
            "action",
            "aria-current",
            "aria-label",
            "aria-labelledby",
            "href",
            "name",
            "value"
          ],
          characterData: true,
          childList: true,
          subtree: true
        });
      }
    };
    const notifyPageChange = (eventOrFresh?: Event | boolean): void => {
      const previewContentChanged = eventOrFresh === true;
      if (location.href !== observedHref) {
        previewHeadingFresh = false;
      }
      if (previewContentChanged) {
        previewHeadingFresh = true;
      }
      observedHref = location.href;
      if (isSupportedList()) {
        markReplacementPending(document.documentElement);
      }
      syncObserverScope();
      listener();
    };
    observer = new window.MutationObserver((mutations) => {
      const externalMutations = mutations.filter((mutation) => !isExtensionOnlyMutation(mutation));
      const previewContentChanged = externalMutations.some(touchesPreviewContent);
      if (location.href !== observedHref || externalMutations.some(isRelevantPageMutation)) {
        notifyPageChange(previewContentChanged);
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
