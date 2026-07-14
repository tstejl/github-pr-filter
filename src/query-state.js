(function exposeQueryState(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GitHubPrFilterQuery = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createQueryState() {
  "use strict";

  const DEFAULT_PREFERENCES = Object.freeze({ lifecycle: "all" });
  const LIFECYCLE_VALUES = new Set(["all", "ready", "draft", "merged", "closed"]);

  function tokenizeQuery(query) {
    const input = typeof query === "string" ? query.trim() : "";
    const tokens = [];
    let token = "";
    let quote = null;
    let escaped = false;

    for (const character of input) {
      if (escaped) {
        token += character;
        escaped = false;
        continue;
      }

      if (character === "\\") {
        token += character;
        escaped = true;
        continue;
      }

      if (quote) {
        token += character;
        if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === '"' || character === "'") {
        token += character;
        quote = character;
        continue;
      }

      if (/\s/.test(character)) {
        if (token) {
          tokens.push(token);
          token = "";
        }
        continue;
      }

      token += character;
    }

    if (token) {
      tokens.push(token);
    }

    return tokens;
  }

  function stateForToken(token) {
    switch (token.toLowerCase()) {
      case "is:open":
      case "state:open":
        return "open";
      case "is:closed":
      case "state:closed":
        return "closed";
      default:
        return null;
    }
  }

  function readinessForToken(token) {
    switch (token.toLowerCase()) {
      case "draft:true":
      case "is:draft":
        return "draft";
      case "draft:false":
      case "-is:draft":
        return "ready";
      default:
        return null;
    }
  }

  function mergeForToken(token) {
    switch (token.toLowerCase()) {
      case "is:merged":
        return "merged";
      case "is:unmerged":
      case "-is:merged":
        return "unmerged";
      default:
        return null;
    }
  }

  function inspectQuery(query) {
    const tokens = tokenizeQuery(query);
    let state = null;
    let readiness = null;
    let merge = null;

    for (const token of tokens) {
      state = stateForToken(token) || state;
      readiness = readinessForToken(token) || readiness;
      merge = mergeForToken(token) || merge;
    }

    let lifecycle = null;
    if (merge === "merged") {
      lifecycle = "merged";
    } else if (state === "closed") {
      lifecycle = "closed";
    } else if (readiness) {
      lifecycle = readiness;
    } else if (state === "open") {
      lifecycle = "all";
    }

    return { tokens, state, readiness, merge, lifecycle };
  }

  function serializeTokens(tokens) {
    return tokens.filter(Boolean).join(" ");
  }

  function queryWithLifecycle(query, lifecycle) {
    const safeLifecycle = LIFECYCLE_VALUES.has(lifecycle)
      ? lifecycle
      : DEFAULT_PREFERENCES.lifecycle;
    const tokens = tokenizeQuery(query).filter((token) => {
      return !stateForToken(token) && !readinessForToken(token) && !mergeForToken(token);
    });

    if (safeLifecycle === "merged") {
      tokens.push("is:merged");
    } else if (safeLifecycle === "closed") {
      tokens.push("is:closed", "is:unmerged");
    } else {
      tokens.push("is:open");
      if (safeLifecycle === "ready") {
        tokens.push("draft:false");
      } else if (safeLifecycle === "draft") {
        tokens.push("draft:true");
      }
    }

    return serializeTokens(tokens);
  }

  function reconcileQuery(query) {
    const inspection = inspectQuery(query);
    const lifecycle = inspection.lifecycle || DEFAULT_PREFERENCES.lifecycle;

    return {
      query,
      effective: { lifecycle }
    };
  }

  return Object.freeze({
    DEFAULT_PREFERENCES,
    inspectQuery,
    queryWithLifecycle,
    reconcileQuery,
    tokenizeQuery
  });
});
