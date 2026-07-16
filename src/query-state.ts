import {
  DEFAULT_PREFERENCES,
  isLifecycle,
  type Lifecycle,
  type LifecyclePreferences
} from "./lifecycle-options";

type PullRequestState = "open" | "closed";
type Readiness = "ready" | "draft";
type MergeState = "merged" | "unmerged";

export interface QueryInspection {
  tokens: string[];
  state: PullRequestState | null;
  readiness: Readiness | null;
  merge: MergeState | null;
  lifecycle: Lifecycle | null;
}

export interface QueryReconciliation {
  query: string;
  effective: LifecyclePreferences;
}

const NEEDS_REVIEW_TOKENS = ["-review:approved", "-review:changes_requested"] as const;

export { DEFAULT_PREFERENCES };

export function tokenizeQuery(query: string): string[] {
  const input = query.trim();
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;
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

function stateForToken(token: string): PullRequestState | null {
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

function readinessForToken(token: string): Readiness | null {
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

function needsReviewForToken(token: string): typeof NEEDS_REVIEW_TOKENS[number] | null {
  const lowered = token.toLowerCase();
  return NEEDS_REVIEW_TOKENS.find((candidate) => candidate === lowered) ?? null;
}

function isReviewStatusToken(token: string): boolean {
  return /^-?review:/i.test(token);
}

function mergeForToken(token: string): MergeState | null {
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

export function inspectQuery(query: string): QueryInspection {
  const tokens = tokenizeQuery(query);
  let state: PullRequestState | null = null;
  let readiness: Readiness | null = null;
  let merge: MergeState | null = null;
  const needsReviewTokens = new Set<string>();

  for (const token of tokens) {
    state = stateForToken(token) ?? state;
    readiness = readinessForToken(token) ?? readiness;
    merge = mergeForToken(token) ?? merge;
    const needsReview = needsReviewForToken(token);
    if (needsReview) {
      needsReviewTokens.add(needsReview);
    }
  }

  let lifecycle: Lifecycle | null = null;
  if (merge === "merged") {
    lifecycle = "merged";
  } else if (state === "closed" && merge === "unmerged") {
    lifecycle = "closed_unmerged";
  } else if (state === "closed") {
    lifecycle = "closed";
  } else if (readiness === "ready" && needsReviewTokens.size === NEEDS_REVIEW_TOKENS.length) {
    lifecycle = "needs_review";
  } else if (readiness) {
    lifecycle = readiness;
  } else if (state === "open") {
    lifecycle = "open";
  }

  return { tokens, state, readiness, merge, lifecycle };
}

function serializeTokens(tokens: readonly string[]): string {
  return tokens.filter(Boolean).join(" ");
}

export function queryWithLifecycle(query: string, lifecycle: string): string {
  const safeLifecycle = isLifecycle(lifecycle) ? lifecycle : DEFAULT_PREFERENCES.lifecycle;
  const tokens = tokenizeQuery(query).filter((token) => {
    if (stateForToken(token) || readinessForToken(token) || mergeForToken(token)) {
      return false;
    }
    if (needsReviewForToken(token)) {
      return false;
    }
    return safeLifecycle !== "needs_review" || !isReviewStatusToken(token);
  });

  if (safeLifecycle === "merged") {
    tokens.push("is:merged");
  } else if (safeLifecycle === "closed_unmerged") {
    tokens.push("is:closed", "is:unmerged");
  } else if (safeLifecycle === "closed") {
    tokens.push("is:closed");
  } else {
    tokens.push("is:open");
    if (safeLifecycle === "ready") {
      tokens.push("draft:false");
    } else if (safeLifecycle === "needs_review") {
      tokens.push("draft:false", ...NEEDS_REVIEW_TOKENS);
    } else if (safeLifecycle === "draft") {
      tokens.push("draft:true");
    }
  }

  return serializeTokens(tokens);
}

export function reconcileQuery(query: string): QueryReconciliation {
  const inspection = inspectQuery(query);
  const lifecycle = inspection.lifecycle ?? DEFAULT_PREFERENCES.lifecycle;
  return { query, effective: { lifecycle } };
}
