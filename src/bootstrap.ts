import {
  previewRegions,
  HIDDEN_NATIVE_STATUS_CLASS,
  HIDDEN_NATIVE_RESULTS_CLASS
} from "./github-preview-header";
import { isRepositoryIssueListPath, isRepositoryPullListPath } from "./page-scope";
import { createPageMarkerController } from "./page-markers";

const pageMarkers = createPageMarkerController({
  root: () => document.documentElement
});

function isSupportedUrl(value: string): boolean {
  try {
    const url = new URL(value, location.href);
    return (
      url.origin === location.origin &&
      (isRepositoryPullListPath(url.pathname) || isRepositoryIssueListPath(url.pathname))
    );
  } catch {
    return false;
  }
}

function updatePageMarker(value = location.href): void {
  pageMarkers.update(isSupportedUrl(value));
}

function beginReplacement(value = location.href): void {
  if (isSupportedUrl(value)) {
    pageMarkers.update(true);
  }
}

updatePageMarker();
if (!document.documentElement) {
  document.addEventListener("readystatechange", () => updatePageMarker(), { once: true });
}

document.addEventListener("turbo:before-visit", (event) => {
  const destination = (event as CustomEvent<{ url?: string }>).detail?.url;
  if (destination) {
    beginReplacement(destination);
  }
});
document.addEventListener("turbo:before-render", () => beginReplacement());
document.addEventListener("turbo:before-frame-render", () => beginReplacement());
document.addEventListener("turbo:load", () => updatePageMarker());
window.addEventListener("popstate", () => beginReplacement());

// Run in the document-start bundle: mark recognized preview controls before the
// first paint, even when the interactive bundle is delayed by page hydration.
const previewObserver = new MutationObserver(() => {
  if (
    !isSupportedUrl(location.href) ||
    !document.documentElement?.matches(".gprf-replacement-pending, .gprf-replacement-mounted")
  )
    return;
  for (const region of previewRegions(document)) {
    for (const { element } of region.controls) element.classList.add(HIDDEN_NATIVE_STATUS_CLASS);
    region.heading?.classList.add(HIDDEN_NATIVE_RESULTS_CLASS);
  }
});
previewObserver.observe(document, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["role", "aria-label"]
});
