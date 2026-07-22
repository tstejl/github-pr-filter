import { LIFECYCLES, type Lifecycle } from "./lifecycle";
import {
  createLifecycleQueryPlan,
  type LifecycleQueryAnalysis,
  type PullRequestQueryInput
} from "./lifecycle-query";

export type GitHubQueryParameter = "q" | "query";

export interface PullListQueryContext {
  readonly pageUrl: string;
  readonly input: PullRequestQueryInput;
  readonly queryParameter: GitHubQueryParameter;
}

export type LifecycleActionUrls = Readonly<Record<Lifecycle, string | null>>;

export interface LifecycleNavigationPlan {
  readonly analysis: LifecycleQueryAnalysis;
  readonly actionUrls: LifecycleActionUrls;
}

function urlForQuery(context: PullListQueryContext, query: string): URL {
  const url = new URL(context.pageUrl);
  const normalizedQuery = query.trim();
  const unusedParameter = context.queryParameter === "q" ? "query" : "q";

  if (normalizedQuery) {
    url.searchParams.set(context.queryParameter, normalizedQuery);
  } else {
    url.searchParams.delete(context.queryParameter);
  }
  url.searchParams.delete(unusedParameter);
  url.searchParams.delete("page");
  return url;
}

export function createLifecycleNavigationPlan(
  context: PullListQueryContext
): LifecycleNavigationPlan {
  const queryPlan = createLifecycleQueryPlan(context.input);
  const actionUrls = {} as Record<Lifecycle, string | null>;
  for (const lifecycle of LIFECYCLES) {
    const rewrite = queryPlan.transitions[lifecycle];
    actionUrls[lifecycle] =
      rewrite.kind === "unsafe" ? null : urlForQuery(context, rewrite.input.source).href;
  }
  return { analysis: queryPlan.analysis, actionUrls };
}

export function createLifecycleActionUrls(context: PullListQueryContext): LifecycleActionUrls {
  return createLifecycleNavigationPlan(context).actionUrls;
}
