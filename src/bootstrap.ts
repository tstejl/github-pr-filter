import { isRepositoryPullListPath } from "./page-scope";

const SUPPORTED_CLASS = "gprf-supported-page";

function isSupportedUrl(value: string): boolean {
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin && isRepositoryPullListPath(url.pathname);
  } catch {
    return false;
  }
}

function updatePageMarker(value = location.href): void {
  document.documentElement?.classList.toggle(SUPPORTED_CLASS, isSupportedUrl(value));
}

updatePageMarker();
if (!document.documentElement) {
  document.addEventListener("readystatechange", () => updatePageMarker(), { once: true });
}

document.addEventListener("turbo:before-visit", (event) => {
  const destination = (event as CustomEvent<{ url?: string }>).detail?.url;
  if (destination && isSupportedUrl(destination)) {
    updatePageMarker(destination);
  }
});
document.addEventListener("turbo:load", () => updatePageMarker());
window.addEventListener("popstate", () => updatePageMarker());
