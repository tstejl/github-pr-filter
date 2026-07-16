import {
  CONTROL_CLASS,
  createLifecycleControl,
  refreshLifecycleControl
} from "./lifecycle-control";
import {
  DEFAULT_PREFERENCES,
  type Lifecycle,
  type LifecyclePreferences
} from "./lifecycle-options";
import { isRepositoryPullListPath } from "./page-scope";
import { inspectQuery, queryWithLifecycle, reconcileQuery } from "./query-state";

let activePreferences: LifecyclePreferences = { ...DEFAULT_PREFERENCES };
let lastReconciledUrl: string | null = null;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;

function isSupportedPage(): boolean {
  return isRepositoryPullListPath(location.pathname);
}

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

function createControl(
  preferences: LifecyclePreferences,
  standalone = false,
  count: string | null = null
): HTMLDetailsElement {
  return createLifecycleControl({
    preferences,
    standalone,
    count,
    hrefForLifecycle
  });
}

function refreshControl(
  control: HTMLDetailsElement,
  preferences: LifecyclePreferences,
  count: string | null = null
): void {
  refreshLifecycleControl(control, { preferences, count, hrefForLifecycle });
}

function nativeStatusGroups(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".table-list-header-toggle.states")];
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

    const count = link.textContent.trim().match(/[\p{Number}][\p{Number}\s.,]*/u)?.[0].trim();
    if (count) {
      return count;
    }
  }
  return null;
}

function syncTurboFrame(control: HTMLDetailsElement, group: HTMLElement): void {
  const turboFrame = group.querySelector<HTMLAnchorElement>(":scope > a[data-turbo-frame]")
    ?.getAttribute("data-turbo-frame");
  if (!turboFrame) {
    return;
  }

  for (const link of control.querySelectorAll<HTMLAnchorElement>(".gprf-lifecycle-option")) {
    link.setAttribute("data-turbo-frame", turboFrame);
  }
}

function mountControls(): void {
  if (!isSupportedPage()) {
    return;
  }

  const groups = nativeStatusGroups();
  if (groups.length > 0) {
    for (const group of groups) {
      const count = nativeCountForLifecycle(group, activePreferences.lifecycle);
      const existingControl = group.querySelector<HTMLDetailsElement>(`:scope > .${CONTROL_CLASS}`);
      if (existingControl) {
        syncTurboFrame(existingControl, group);
        refreshControl(existingControl, activePreferences, count);
        continue;
      }

      for (const nativeLink of group.querySelectorAll<HTMLElement>(":scope > a.btn-link")) {
        nativeLink.classList.add("gprf-native-status-hidden");
      }
      const control = createControl(activePreferences, false, count);
      syncTurboFrame(control, group);
      group.append(control);
    }
    return;
  }

  const existingControl = document.querySelector<HTMLDetailsElement>(`.${CONTROL_CLASS}`);
  if (existingControl) {
    refreshControl(existingControl, activePreferences);
    return;
  }

  const searchInput = getSearchInput();
  const searchContainer = searchInput?.closest("form, [role='search'], search");
  if (searchContainer) {
    searchContainer.insertAdjacentElement("afterend", createControl(activePreferences, true));
  }
}

function removeControls(): void {
  document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => control.remove());
  document.querySelectorAll(".gprf-native-status-hidden").forEach((link) => {
    link.classList.remove("gprf-native-status-hidden");
  });
}

function reconcileAndMount(): void {
  if (!isSupportedPage()) {
    removeControls();
    lastReconciledUrl = null;
    return;
  }

  const currentUrl = location.href;
  if (lastReconciledUrl !== currentUrl) {
    activePreferences = reconcileQuery(getCurrentQuery()).effective;
    lastReconciledUrl = currentUrl;
  }
  mountControls();
}

function scheduleReconcile(): void {
  if (scheduledTimer !== null) {
    clearTimeout(scheduledTimer);
  }
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    reconcileAndMount();
  }, 60);
}

document.addEventListener("click", (event) => {
  for (const control of document.querySelectorAll<HTMLDetailsElement>(`.${CONTROL_CLASS}[open]`)) {
    if (!(event.target instanceof Node) || !control.contains(event.target)) {
      control.removeAttribute("open");
    }
  }
});

window.addEventListener("popstate", scheduleReconcile);
document.addEventListener("turbo:load", scheduleReconcile);

const observer = new MutationObserver(scheduleReconcile);
observer.observe(document.documentElement, { childList: true, subtree: true });

reconcileAndMount();
