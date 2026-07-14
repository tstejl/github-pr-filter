(function exposePageScope(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GitHubPrFilterScope = api;
})(typeof globalThis === "object" ? globalThis : this, function createPageScope() {
  "use strict";

  const REPOSITORY_PULLS_PATH = /^\/[^/]+\/[^/]+\/pulls\/?$/;

  function isRepositoryPullListPath(pathname) {
    return REPOSITORY_PULLS_PATH.test(pathname);
  }

  return Object.freeze({ isRepositoryPullListPath });
});
