(function initializeGitHubPrFilterBootstrap() {
  "use strict";

  const pageScope = globalThis.GitHubPrFilterScope;
  const SUPPORTED_CLASS = "gprf-supported-page";

  if (!pageScope) {
    return;
  }

  function isSupportedUrl(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin
        && pageScope.isRepositoryPullListPath(url.pathname);
    } catch {
      return false;
    }
  }

  function updatePageMarker(value = location.href) {
    document.documentElement?.classList.toggle(SUPPORTED_CLASS, isSupportedUrl(value));
  }

  updatePageMarker();
  if (!document.documentElement) {
    document.addEventListener("readystatechange", () => updatePageMarker(), { once: true });
  }

  // Add the marker before Turbo swaps in a PR list. When leaving a PR list,
  // keep it until turbo:load so the old native controls cannot flash mid-swap.
  document.addEventListener("turbo:before-visit", (event) => {
    if (isSupportedUrl(event.detail?.url)) {
      updatePageMarker(event.detail.url);
    }
  });
  document.addEventListener("turbo:load", () => updatePageMarker());
  window.addEventListener("popstate", () => updatePageMarker());
})();
