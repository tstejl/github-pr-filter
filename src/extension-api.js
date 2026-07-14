(function exposeExtensionApi(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory;
  } else {
    root.GitHubPrFilterExtensionApi = factory(root);
  }
})(typeof globalThis === "object" ? globalThis : this, function createExtensionApi(runtime) {
  "use strict";

  // Firefox's browser namespace is promise-based. Chromium exposes the same
  // storage methods through chrome in Manifest V3.
  const namespace = runtime?.browser?.storage?.local
    ? runtime.browser
    : runtime?.chrome;

  if (!namespace?.storage?.local) {
    return null;
  }

  return Object.freeze({
    get: (...keys) => namespace.storage.local.get(...keys),
    set: (...items) => namespace.storage.local.set(...items)
  });
});
