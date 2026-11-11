import {
  previewRegions,
  refreshPreviewRegion,
  previewAccessibleText,
  parseResultHeadingCount,
  HIDDEN_NATIVE_STATUS_CLASS,
  HIDDEN_NATIVE_RESULTS_CLASS,
  PREVIEW_TOOLBAR_SELECTOR,
  type PreviewRegion
} from "./github-preview-header";
import { clearPageMarkers, markReplacementMounted } from "./page-markers";
import { repositoryKeyFromPullListPath } from "./page-scope";
import { createViewsMenu, type ViewsMenuState } from "./views-menu";
import { loadViewScope, saveViewScopes, subscribeViewScopes } from "./views-storage";
import {
  transitionContentScopes,
  transitionCountFreshness,
  type ContentScopesState,
  type CountFreshnessState,
  type CountPage
} from "./views-content-state";

function query(): string {
  const url = new URL(location.href);
  if (url.searchParams.has("q")) return url.searchParams.get("q") ?? "";
  return (
    document.querySelector<HTMLInputElement>(
      'main input[placeholder*="Search pull requests" i], main input[aria-label*="Search pull requests" i], input[name="q"]'
    )?.defaultValue ?? ""
  );
}

function isAssociatedList(element: HTMLElement, regions: readonly PreviewRegion[]): boolean {
  return (element.getAttribute("aria-labelledby")?.split(/\s+/u) ?? []).some((id) => {
    if (!id.endsWith("-list-view-container-title")) return false;
    const metadata = document.getElementById(
      id.replace(/-list-view-container-title$/u, "-list-view-metadata")
    );
    return metadata && regions.some(({ root }) => metadata.contains(root));
  });
}
function associatedListBusy(regions: readonly PreviewRegion[]): boolean {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[data-listview-component="items-list"][aria-busy="true"]'
    )
  ].some((element) => isAssociatedList(element, regions));
}
const countPage = (): CountPage => ({
  repository: repositoryKeyFromPullListPath(location.pathname),
  query: query()
});

export function startSavedViewsContent(): void {
  type Menu = ReturnType<typeof createViewsMenu>;
  const mounts = new Map<HTMLElement, { region: PreviewRegion; menu: Menu }>();
  const hiddenControls = new Set<HTMLElement>();
  const hiddenHeadings = new Set<HTMLElement>();
  let scopes: ContentScopesState = { phase: "inactive", requestId: 0 };
  let scheduled = false;
  let observedHref = location.href;
  let freshness: CountFreshnessState = { phase: "fresh", page: countPage() };

  function restore(): void {
    for (const element of hiddenControls) element.classList.remove(HIDDEN_NATIVE_STATUS_CLASS);
    for (const element of hiddenHeadings) element.classList.remove(HIDDEN_NATIVE_RESULTS_CLASS);
    hiddenControls.clear();
    hiddenHeadings.clear();
    for (const { menu } of mounts.values()) menu.destroy();
    mounts.clear();
    clearPageMarkers(document.documentElement);
  }
  function nativeCount(region: PreviewRegion): string | null {
    if (freshness.phase !== "fresh") return null;
    if (region.heading && /^loading\b/iu.test(previewAccessibleText(region.heading))) return null;
    if (region.heading) {
      const count = parseResultHeadingCount(previewAccessibleText(region.heading));
      if (count !== null) return count;
    }
    // Only trust an explicitly selected native partition. Arbitrary queries are
    // never partitioned or counted by the extension's own interpretation.
    const current = region.controls.find(
      ({ element }) =>
        element.getAttribute("aria-current") === "true" ||
        element.getAttribute("aria-selected") === "true" ||
        element.getAttribute("aria-pressed") === "true" ||
        element.getAttribute("data-state") === "on" ||
        element.classList.contains("selected")
    );
    return (
      (current ? previewAccessibleText(current.element) : "")
        .match(/[\p{Number}][\p{Number}\s.,]*/u)?.[0]
        ?.trim() ?? null
    );
  }
  function render(): void {
    const currentRepo = repositoryKeyFromPullListPath(location.pathname);
    const previousRepository = scopes.phase === "inactive" ? null : scopes.repository;
    scopes = transitionContentScopes(scopes, { type: "route", repository: currentRepo });
    freshness = transitionCountFreshness(freshness, { type: "page", page: countPage() });
    if (previousRepository !== currentRepo || scopes.phase === "inactive") restore();
    if (scopes.phase === "inactive") return;
    if (scopes.phase !== "ready") {
      const next = transitionContentScopes(scopes, { type: "load" });
      if (next === scopes || next.phase !== "loading") return;
      scopes = next;
      const { repository, requestId } = next;
      void loadViewScope(repository)
        .then((local) => {
          const loaded = transitionContentScopes(scopes, {
            type: "loaded",
            repository,
            requestId,
            local
          });
          if (loaded === scopes) return;
          scopes = loaded;
          schedule();
          return undefined;
        })
        .catch((error: unknown) => {
          const failed = transitionContentScopes(scopes, { type: "failed", repository, requestId });
          if (failed === scopes) return;
          scopes = failed;
          console.error("GitHub PR Filter: could not load views.", error);
        });
      return;
    }
    const discovered = previewRegions(document);
    const refreshed = [...mounts.values()]
      .filter(({ region }) => region.toolbar.matches(PREVIEW_TOOLBAR_SELECTOR))
      .map(({ region }) => refreshPreviewRegion(region))
      .filter((region): region is PreviewRegion => region !== null);
    const regions = discovered.length ? discovered : refreshed;
    const slots = new Set(regions.map(({ slot }) => slot));
    for (const [slot, mount] of mounts)
      if (!slots.has(slot)) {
        mount.menu.destroy();
        mounts.delete(slot);
      }
    const keepControls = new Set(
      regions.flatMap((region) => region.controls.map(({ element }) => element))
    );
    const keepHeadings = new Set(
      regions.flatMap((region) => (region.heading ? [region.heading] : []))
    );
    for (const element of hiddenControls)
      if (!keepControls.has(element)) {
        element.classList.remove(HIDDEN_NATIVE_STATUS_CLASS);
        hiddenControls.delete(element);
      }
    for (const element of hiddenHeadings)
      if (!keepHeadings.has(element)) {
        element.classList.remove(HIDDEN_NATIVE_RESULTS_CLASS);
        hiddenHeadings.delete(element);
      }
    if (!regions.length) {
      restore();
      return;
    }
    freshness = transitionCountFreshness(freshness, {
      type: "observed",
      page: countPage(),
      busy: associatedListBusy(regions),
      loadingStarted: false,
      listCompleted: false,
      countChanged: false,
      headerReplaced: false
    });
    for (const region of regions) {
      const state: ViewsMenuState = {
        repository: scopes.repository,
        pageUrl: location.href,
        query: query(),
        count: nativeCount(region),
        repositorySnapshot: scopes.local
      };
      const existing = mounts.get(region.slot);
      if (existing?.menu.element.isConnected) {
        existing.region = region;
        existing.menu.refresh(state);
      } else {
        existing?.menu.destroy();
        const menu = createViewsMenu(document, state, async (update) => {
          await saveViewScopes([update]);
          return update;
        });
        region.slot.insertBefore(
          menu.element,
          region.anchor.parentElement === region.slot ? region.anchor : null
        );
        mounts.set(region.slot, { region, menu });
      }
      for (const { element } of region.controls) {
        element.classList.add(HIDDEN_NATIVE_STATUS_CLASS);
        hiddenControls.add(element);
      }
      if (region.heading) {
        region.heading.classList.add(HIDDEN_NATIVE_RESULTS_CLASS);
        hiddenHeadings.add(region.heading);
      }
    }
    markReplacementMounted(document.documentElement);
  }
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    // GitHub can replace the entire header during a filter change. Reconcile
    // within this mutation checkpoint, before a frame can paint native controls.
    // A timer permits the new header to flash even when its classes were hidden
    // on the previous nodes. The flag still coalesces signals in the same task.
    queueMicrotask(() => {
      scheduled = false;
      safeRender();
    });
  }
  function navigation(): void {
    if (observedHref !== location.href) {
      observedHref = location.href;
      for (const { menu } of mounts.values()) menu.close();
    }
    freshness = transitionCountFreshness(freshness, { type: "page", page: countPage() });
    schedule();
  }
  const observer = new MutationObserver((records) => {
    const external = records.filter((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".gprf-saved-views")) return false;
      if (
        record.type === "childList" &&
        [...record.addedNodes, ...record.removedNodes].every(
          (node) => node instanceof Element && node.matches(".gprf-saved-views")
        )
      )
        return false;
      return true;
    });
    if (!external.length) return;
    navigation();
    const currentRegions = previewRegions(document);
    const loadingStarted = external.some(
      (record) =>
        record.type === "attributes" &&
        record.attributeName === "aria-busy" &&
        record.target instanceof HTMLElement &&
        record.target.matches('[data-listview-component="items-list"][aria-busy="true"]') &&
        isAssociatedList(record.target, currentRegions)
    );
    const listCompleted = external.some(
      (record) =>
        record.type === "attributes" &&
        record.attributeName === "aria-busy" &&
        record.oldValue === "true" &&
        record.target instanceof HTMLElement &&
        record.target.matches('[data-listview-component="items-list"][aria-busy="false"]') &&
        isAssociatedList(record.target, currentRegions)
    );
    const countChanged = external.some((record) => {
      if (record.type === "attributes" && record.attributeName !== "aria-label") return false;
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return [...mounts.values()].some(({ region }) => {
        if (
          target &&
          ((region.heading?.contains(target) ?? false) ||
            region.controls.some(({ element }) => element === target || element.contains(target)))
        )
          return true;
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node === region.heading ||
              region.controls.some(({ element }) => node === element) ||
              (region.root.contains(node) &&
                (node.matches("h1,h2,h3,[role=heading]") ||
                  node.querySelector("h1,h2,h3,[role=heading]"))))
        );
      });
    });
    const newHeader = external.some(
      (record) =>
        record.type === "childList" &&
        [...record.addedNodes].some(
          (node) =>
            node instanceof Element &&
            currentRegions.some(
              (region) =>
                node === region.root ||
                node.contains(region.root) ||
                (region.heading && (node === region.heading || node.contains(region.heading)))
            )
        )
    );
    freshness = transitionCountFreshness(freshness, {
      type: "observed",
      page: countPage(),
      loadingStarted,
      busy: associatedListBusy(currentRegions),
      listCompleted,
      countChanged,
      headerReplaced: newHeader
    });
    schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["aria-label", "aria-current", "aria-selected", "aria-busy", "value", "href"]
  });
  for (const event of ["turbo:load", "turbo:render", "turbo:frame-load", "pjax:end"])
    document.addEventListener(event, navigation);
  document.addEventListener("turbo:before-visit", (event) => {
    let allowed = true;
    for (const { menu } of mounts.values()) {
      if (!menu.requestClose()) allowed = false;
    }
    if (!allowed) {
      event.preventDefault();
      return;
    }
    freshness = transitionCountFreshness(freshness, { type: "navigation-start" });
  });
  window.addEventListener("popstate", navigation);
  window.setInterval(navigation, 500);
  subscribeViewScopes((scope) => {
    const next = transitionContentScopes(scopes, { type: "storage-changed", scope });
    if (next === scopes) return;
    scopes = next;
    schedule();
  });
  function safeRender(): void {
    try {
      render();
    } catch (error) {
      restore();
      console.error("GitHub PR Filter: could not render saved views.", error);
    }
  }
  safeRender();
}
