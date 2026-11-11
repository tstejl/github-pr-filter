import type { ViewScopeSnapshot } from "./views-storage";

/** A request ID belongs to one repository and one invalidation generation. */
export type ContentScopesState =
  | { phase: "inactive"; requestId: number }
  | { phase: "idle" | "loading" | "failed"; repository: string; requestId: number }
  | {
      phase: "ready";
      repository: string;
      requestId: number;
      local: ViewScopeSnapshot;
    };
export type ContentScopesEvent =
  | { type: "route"; repository: string | null }
  | { type: "load" }
  | { type: "storage-changed"; scope: string }
  | {
      type: "loaded";
      repository: string;
      requestId: number;
      local: ViewScopeSnapshot;
    }
  | { type: "failed"; repository: string; requestId: number };

export function transitionContentScopes(
  state: ContentScopesState,
  event: ContentScopesEvent
): ContentScopesState {
  switch (event.type) {
    case "route": {
      const current = state.phase === "inactive" ? null : state.repository;
      if (event.repository === current) return state;
      return event.repository === null
        ? { phase: "inactive", requestId: state.requestId + 1 }
        : { phase: "idle", repository: event.repository, requestId: state.requestId + 1 };
    }
    case "load":
      return state.phase === "idle" || state.phase === "failed"
        ? { phase: "loading", repository: state.repository, requestId: state.requestId + 1 }
        : state;
    case "storage-changed":
      return state.phase !== "inactive" && event.scope === state.repository
        ? { phase: "idle", repository: state.repository, requestId: state.requestId + 1 }
        : state;
    case "loaded":
    case "failed":
      if (
        state.phase !== "loading" ||
        event.requestId !== state.requestId ||
        event.repository !== state.repository
      )
        return state;
      return event.type === "failed"
        ? { phase: "failed", repository: state.repository, requestId: state.requestId }
        : {
            phase: "ready",
            repository: state.repository,
            requestId: state.requestId,
            local: event.local
          };
  }
}

export interface CountPage {
  repository: string | null;
  query: string;
}
export type CountFreshnessState = {
  phase: "fresh" | "stale" | "loading";
  page: CountPage;
};
export type CountFreshnessEvent =
  | { type: "page"; page: CountPage }
  | { type: "navigation-start" }
  | {
      type: "observed";
      page: CountPage;
      loadingStarted: boolean;
      busy: boolean;
      listCompleted: boolean;
      countChanged: boolean;
      headerReplaced: boolean;
    };

function samePage(left: CountPage, right: CountPage): boolean {
  return left.repository === right.repository && left.query === right.query;
}

/** Loading persists across observer batches; count text alone cannot finish it. */
export function transitionCountFreshness(
  state: CountFreshnessState,
  event: CountFreshnessEvent
): CountFreshnessState {
  switch (event.type) {
    case "page":
      return samePage(state.page, event.page) ? state : { phase: "stale", page: event.page };
    case "navigation-start":
      return { phase: "stale", page: state.page };
    case "observed":
      if (!samePage(state.page, event.page) || state.page.repository === null) return state;
      if (event.loadingStarted || event.busy) return { phase: "loading", page: state.page };
      if (
        event.listCompleted ||
        event.headerReplaced ||
        (state.phase !== "loading" && event.countChanged)
      )
        return { phase: "fresh", page: state.page };
      return state;
  }
}
