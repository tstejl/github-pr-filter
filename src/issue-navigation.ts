import { LIFECYCLES, type Lifecycle } from "./lifecycle";
import { createIssueQueryPlan, type IssueQueryAnalysis, type IssueQueryInput } from "./issue-query";
import type { LifecycleActionUrls, PullListQueryContext } from "./lifecycle-navigation";

export interface IssueNavigationPlan {
  readonly analysis: IssueQueryAnalysis;
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

export function createIssueNavigationPlan(context: PullListQueryContext): IssueNavigationPlan {
  const queryPlan = createIssueQueryPlan(context.input as IssueQueryInput);
  const actionUrls = Object.fromEntries(
    LIFECYCLES.map((lifecycle) => {
      const rewrite = queryPlan.transitions[lifecycle as keyof typeof queryPlan.transitions];
      return [
        lifecycle,
        rewrite === undefined || rewrite.kind === "unsafe"
          ? null
          : urlForQuery(context, rewrite.input.source).href
      ];
    })
  ) as Record<Lifecycle, string | null>;
  return { analysis: queryPlan.analysis, actionUrls };
}

export function createIssueActionUrls(context: PullListQueryContext): LifecycleActionUrls {
  return createIssueNavigationPlan(context).actionUrls;
}
