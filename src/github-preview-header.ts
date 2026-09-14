import { CONTROL_CLASS } from "./page-markers";
import type { PreviewStatusControl } from "./github-pull-list-contract";

export const HIDDEN_NATIVE_STATUS_CLASS = "gprf-native-status-hidden";
export const HIDDEN_NATIVE_RESULTS_CLASS = "gprf-native-results-hidden";
export const PREVIEW_CONTROL_CLASS = "gprf-lifecycle--preview";
const PREVIEW_METADATA_SELECTOR = '[id$="-list-view-metadata"]';
export const PREVIEW_TOOLBAR_SELECTOR = `:is(main, [role="main"], ${PREVIEW_METADATA_SELECTOR}) [role="toolbar"][aria-label="Pull request filters"]`;
export const PREVIEW_HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,[role='heading']";
export const PREVIEW_STATUS_CONTROL_SELECTOR = "button,a,[role='button'],[role='tab']";

// The preview header is scoped by its filter toolbar. Status controls and result
// headings are siblings of that toolbar, never controls inside the filter menu.
type PreviewLifecycle = PreviewStatusControl["lifecycle"];

interface PreviewStatusCandidate {
  readonly element: HTMLElement;
  readonly control: PreviewStatusControl;
}

export interface PreviewRegion {
  readonly root: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly slot: HTMLElement;
  readonly anchor: HTMLElement;
  readonly heading: HTMLElement | null;
  readonly controls: readonly PreviewStatusCandidate[];
}

export function previewAccessibleText(element: HTMLElement): string {
  const ariaLabel = element.getAttribute("aria-label")?.trim() ?? "";
  // GitHub renders both an aria-hidden CounterLabel and a screen-reader count.
  // Reading textContent directly produces "Open25 (25)" and duplicates the count.
  const accessible = element.cloneNode(true) as HTMLElement;
  accessible.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  const text = (accessible.textContent ?? "").replace(/\s+/gu, " ").trim();
  if (!ariaLabel) {
    return text;
  }
  if (!text || /\p{Number}/u.test(ariaLabel)) {
    return ariaLabel;
  }
  return `${ariaLabel} ${text}`.trim();
}

export function previewLifecycleForText(text: string): PreviewLifecycle | null {
  const match = text.match(/\b(open|closed)\b/iu)?.[1]?.toLowerCase();
  if (match !== "open" && match !== "closed") {
    return null;
  }
  return match;
}

export function isPreviewResultHeading(element: HTMLElement): boolean {
  return (
    element.matches(PREVIEW_HEADING_SELECTOR) &&
    parseResultHeadingCount(previewAccessibleText(element)) !== null
  );
}

function previewStatusCandidates(
  root: HTMLElement,
  excludedRoot?: HTMLElement
): readonly PreviewStatusCandidate[] {
  const candidates: PreviewStatusCandidate[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(PREVIEW_STATUS_CONTROL_SELECTOR)) {
    if (excludedRoot?.contains(element) || element.closest(`.${CONTROL_CLASS}`)) {
      continue;
    }
    const text = previewAccessibleText(element);
    const lifecycle = previewLifecycleForText(text);
    if (!lifecycle || !/\p{Number}/u.test(text)) {
      continue;
    }
    candidates.push({ element, control: { lifecycle, text } });
  }
  return candidates;
}

export function previewRegionForToolbar(toolbar: HTMLElement): PreviewRegion | null {
  const boundary =
    toolbar.closest(PREVIEW_METADATA_SELECTOR) ?? toolbar.closest("main, [role=main]");
  if (!boundary || toolbar.closest("nav,aside,[role='row'],tr")) {
    return null;
  }

  let root: HTMLElement | null = toolbar;
  let depth = 0;
  while (root && depth < 8) {
    if (
      root.querySelector('input:not([type="checkbox"]), [role=search], form') ||
      root.querySelector(
        "table,[role='row'],ul[aria-label='Pull requests'],[role='list'],a[href*='/pull/']"
      ) ||
      root.closest("nav,aside,[role='row'],tr")
    ) {
      return null;
    }
    const heading =
      [...root.querySelectorAll<HTMLElement>(PREVIEW_HEADING_SELECTOR)].find(
        (element) =>
          !toolbar.contains(element) &&
          (isPreviewResultHeading(element) ||
            /^loading results[.…]*$/iu.test(previewAccessibleText(element)))
      ) ?? null;
    const controls = previewStatusCandidates(root, toolbar);
    const lifecycles = new Set(controls.map(({ control }) => control.lifecycle));
    if (
      !heading &&
      (controls.length !== 2 || !lifecycles.has("open") || !lifecycles.has("closed"))
    ) {
      if (root === boundary) return null;
      root = root.parentElement;
      depth += 1;
      continue;
    }
    const anchorCandidate = controls[0];
    const slot = anchorCandidate?.element.parentElement ?? heading?.parentElement ?? toolbar;
    const anchor = anchorCandidate?.element ?? heading ?? toolbar.firstElementChild;
    if (slot && anchor instanceof HTMLElement) {
      return { root, toolbar, slot, anchor, heading, controls };
    }
    if (root === boundary) return null;
    root = root.parentElement;
    depth += 1;
  }
  return null;
}

export function previewRegions(document: Document): readonly PreviewRegion[] {
  const regions: PreviewRegion[] = [];
  const roots = new Set<HTMLElement>();
  for (const toolbar of document.querySelectorAll<HTMLElement>(PREVIEW_TOOLBAR_SELECTOR)) {
    const region = previewRegionForToolbar(toolbar);
    if (!region || roots.has(region.root)) {
      continue;
    }
    roots.add(region.root);
    regions.push(region);
  }
  return regions;
}

export function refreshPreviewRegion(region: PreviewRegion): PreviewRegion | null {
  if (!region.root.isConnected || !region.toolbar.isConnected || !region.slot.isConnected) {
    return null;
  }
  const controls = previewStatusCandidates(region.root, region.toolbar);
  const heading =
    [...region.root.querySelectorAll<HTMLElement>(PREVIEW_HEADING_SELECTOR)].find(
      isPreviewResultHeading
    ) ?? (region.heading?.isConnected ? region.heading : null);
  const anchorCandidate = controls[0];
  const slot = anchorCandidate?.element.parentElement ?? heading?.parentElement ?? region.slot;
  const anchor = anchorCandidate?.element ?? heading ?? region.anchor;
  if (!slot || !(anchor instanceof HTMLElement) || anchor.parentElement !== slot) {
    return null;
  }
  return { ...region, slot, anchor, heading, controls };
}

/**
 * Read the result heading used by GitHub's pull-list preview. Keep this
 * deliberately narrower than `parseNativeCount`: a heading must say
 * `result(s)` so counts from unrelated controls cannot become the list count.
 */
export function parseResultHeadingCount(text: string): string | null {
  const label = text
    .trim()
    .match(/^(\p{Number}[\p{Number}\s.,]*)\s+results?\b/iu)?.[1]
    ?.trim();
  return label || null;
}
