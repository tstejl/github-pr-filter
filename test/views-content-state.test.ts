import * as assert from "node:assert/strict";
import { test } from "bun:test";
import {
  transitionContentScopes,
  transitionCountFreshness,
  type ContentScopesState,
  type ContentScopesEvent,
  type CountFreshnessState,
  type CountFreshnessEvent,
  type CountPage
} from "../src/views-content-state";
import type { ViewScopeSnapshot } from "../src/views-storage";

const repo = "octocat/repo";
function snapshot(scope: string, revision = "first"): ViewScopeSnapshot {
  return { scope, revision, readOnly: false, layout: { version: 1, entries: [] } };
}
function loading(repository = repo): ContentScopesState {
  return transitionContentScopes(
    transitionContentScopes({ phase: "inactive", requestId: 0 }, { type: "route", repository }),
    { type: "load" }
  );
}
function loaded(state: ContentScopesState): ContentScopesEvent {
  assert.equal(state.phase, "loading");
  if (state.phase !== "loading") throw new Error("Expected pending load");
  return {
    type: "loaded",
    repository: state.repository,
    requestId: state.requestId,
    local: snapshot(state.repository)
  };
}
function ready(): ContentScopesState {
  const pending = loading();
  return transitionContentScopes(pending, loaded(pending));
}

test("inactive settings do not load or react to storage changes", () => {
  const state = Object.freeze({ phase: "inactive" as const, requestId: 7 });
  for (const event of [
    { type: "load" },
    { type: "route", repository: null },
    { type: "storage-changed", scope: "global" }
  ] as const)
    assert.equal(transitionContentScopes(state, event), state);
});

test("route entry starts one request and repeated reconciliation keeps it pending", () => {
  const idle = transitionContentScopes(
    { phase: "inactive", requestId: 0 },
    { type: "route", repository: repo }
  );
  assert.equal(idle.phase, "idle");
  const pending = transitionContentScopes(idle, { type: "load" });
  assert.equal(pending.phase, "loading");
  assert.ok(pending.requestId > idle.requestId);
  assert.equal(transitionContentScopes(pending, { type: "load" }), pending);
  assert.equal(transitionContentScopes(pending, { type: "route", repository: repo }), pending);
});

test("successful load installs the repository snapshot", () => {
  const pending = Object.freeze(loading());
  const event = loaded(pending);
  const state = transitionContentScopes(pending, event);
  assert.equal(state.phase, "ready");
  if (state.phase !== "ready" || event.type !== "loaded")
    throw new Error("Expected ready settings");
  assert.equal(state.local, event.local);
  assert.equal(transitionContentScopes(state, event), state);
  assert.equal(transitionContentScopes(state, { type: "load" }), state);
});

test("stale success and failure cannot replace settings after a repository switch", () => {
  const first = loading();
  let state = transitionContentScopes(first, { type: "route", repository: "octocat/other" });
  state = transitionContentScopes(state, { type: "load" });
  assert.equal(transitionContentScopes(state, loaded(first)), state);
  assert.equal(
    transitionContentScopes(state, {
      type: "failed",
      repository: repo,
      requestId: first.requestId
    }),
    state
  );
  const current = transitionContentScopes(state, loaded(state));
  assert.equal(current.phase, "ready");
  if (current.phase !== "ready") throw new Error("Expected ready settings");
  assert.equal(current.repository, "octocat/other");
  assert.equal(current.local.scope, "octocat/other");
});

test("returning to the same repository does not revive an old request", () => {
  const first = loading();
  let state = transitionContentScopes(first, { type: "route", repository: "octocat/other" });
  state = transitionContentScopes(state, { type: "route", repository: repo });
  state = transitionContentScopes(state, { type: "load" });
  assert.equal(transitionContentScopes(state, loaded(first)), state);
  assert.ok(state.requestId > first.requestId);
});

test("unsupported navigation rejects late completions and clears ready state", () => {
  for (const initial of [loading(), ready()]) {
    const state = transitionContentScopes(initial, { type: "route", repository: null });
    assert.equal(state.phase, "inactive");
    assert.ok(!("local" in state));
    assert.equal(
      transitionContentScopes(state, {
        type: "failed",
        repository: repo,
        requestId: initial.requestId
      }),
      state
    );
    if (initial.phase === "loading")
      assert.equal(transitionContentScopes(state, loaded(initial)), state);
  }
});

test("relevant storage changes invalidate ready and pending settings, unrelated changes do not", () => {
  for (const initial of [loading(), ready()]) {
    assert.equal(
      transitionContentScopes(initial, { type: "storage-changed", scope: "octocat/other" }),
      initial
    );
    assert.equal(
      transitionContentScopes(initial, { type: "storage-changed", scope: "global" }),
      initial
    );
    const invalid = transitionContentScopes(initial, { type: "storage-changed", scope: repo });
    assert.equal(invalid.phase, "idle");
    assert.ok(!("local" in invalid));
    const replacement = transitionContentScopes(invalid, { type: "load" });
    assert.ok(replacement.requestId > initial.requestId);
    if (initial.phase === "loading")
      assert.equal(transitionContentScopes(replacement, loaded(initial)), replacement);
    assert.equal(transitionContentScopes(replacement, loaded(replacement)).phase, "ready");
  }
});

test("a failure is explicit and a retry accepts only the new request", () => {
  const pending = loading();
  const failed = transitionContentScopes(pending, {
    type: "failed",
    repository: repo,
    requestId: pending.requestId
  });
  assert.equal(failed.phase, "failed");
  assert.equal(transitionContentScopes(failed, { type: "route", repository: repo }), failed);
  const retry = transitionContentScopes(failed, { type: "load" });
  assert.equal(retry.phase, "loading");
  assert.ok(retry.requestId > pending.requestId);
  assert.equal(transitionContentScopes(retry, loaded(pending)), retry);
  assert.equal(
    transitionContentScopes(retry, {
      type: "failed",
      repository: repo,
      requestId: pending.requestId
    }),
    retry
  );
});

test("request identity requires both repository and generation", () => {
  const pending = loading();
  for (const event of [
    { type: "failed", repository: "octocat/wrong", requestId: pending.requestId },
    { ...loaded(pending), requestId: pending.requestId - 1 },
    { ...loaded(pending), repository: "octocat/wrong" }
  ] as ContentScopesEvent[])
    assert.equal(transitionContentScopes(pending, event), pending);
});

const page: CountPage = Object.freeze({ repository: repo, query: "is:pr is:open" });
type Observation = Extract<CountFreshnessEvent, { type: "observed" }>;
function observe(overrides: Partial<Observation> = {}): Observation {
  return {
    type: "observed",
    page,
    loadingStarted: false,
    busy: false,
    listCompleted: false,
    countChanged: false,
    headerReplaced: false,
    ...overrides
  };
}
function count(phase: CountFreshnessState["phase"] = "fresh"): CountFreshnessState {
  return { phase, page };
}

test("count belongs to the committed repository and raw query, not only its text", () => {
  for (const next of [
    { repository: "octocat/other", query: page.query },
    { repository: repo, query: "is:pr is:closed" },
    { repository: repo, query: "is:pr state:open" },
    { repository: null, query: page.query }
  ])
    for (const phase of ["fresh", "stale", "loading"] as const) {
      const previous = Object.freeze(count(phase));
      const state = transitionCountFreshness(previous, { type: "page", page: next });
      assert.equal(state.phase, "stale");
      assert.deepEqual(state.page, next);
      assert.equal(previous.phase, phase);
    }
  const initial = count();
  assert.equal(transitionCountFreshness(initial, { type: "page", page: { ...page } }), initial);
});

test("navigation starts by invalidating counts even at the same URL", () => {
  for (const phase of ["fresh", "stale", "loading"] as const) {
    const state = transitionCountFreshness(count(phase), { type: "navigation-start" });
    assert.equal(state.phase, "stale");
    assert.equal(state.page, page);
  }
});

test("busy and loading-start evidence take priority over completion in the same batch", () => {
  for (const phase of ["fresh", "stale", "loading"] as const)
    for (const start of [{ busy: true }, { loadingStarted: true }]) {
      const next = transitionCountFreshness(
        count(phase),
        observe({ ...start, listCompleted: true, headerReplaced: true, countChanged: true })
      );
      assert.equal(next.phase, "loading");
    }
});

test("heading changes across observer callbacks cannot finish a pending list load", () => {
  let state = transitionCountFreshness(count(), observe({ loadingStarted: true }));
  assert.equal(state.phase, "loading");
  for (const busy of [true, false]) {
    state = transitionCountFreshness(state, observe({ countChanged: true, busy }));
    assert.equal(state.phase, "loading");
  }
  state = transitionCountFreshness(state, observe());
  assert.equal(state.phase, "loading");
  state = transitionCountFreshness(state, observe({ listCompleted: true }));
  assert.equal(state.phase, "fresh");
});

test("header replacement completes a load only when its associated list is no longer busy", () => {
  const pending = count("loading");
  assert.equal(
    transitionCountFreshness(pending, observe({ headerReplaced: true, busy: true })).phase,
    "loading"
  );
  assert.equal(transitionCountFreshness(pending, observe({ headerReplaced: true })).phase, "fresh");
});

test("stale counts accept committed text, list completion, or a replacement header", () => {
  for (const evidence of [
    { countChanged: true },
    { listCompleted: true },
    { headerReplaced: true }
  ])
    assert.equal(transitionCountFreshness(count("stale"), observe(evidence)).phase, "fresh");
  const initial = count("stale");
  assert.equal(transitionCountFreshness(initial, observe()), initial);
});

test("completion for an old page cannot make the current count fresh", () => {
  const next = { repository: repo, query: "is:pr is:closed" };
  const stale = transitionCountFreshness(count("loading"), { type: "page", page: next });
  assert.equal(
    transitionCountFreshness(
      stale,
      observe({ listCompleted: true, countChanged: true, headerReplaced: true })
    ),
    stale
  );
  assert.equal(
    transitionCountFreshness(stale, observe({ page: next, listCompleted: true })).phase,
    "fresh"
  );
});

test("unrelated observations preserve count phase and unsupported pages cannot acquire counts", () => {
  for (const phase of ["fresh", "stale", "loading"] as const) {
    const initial = count(phase);
    assert.equal(transitionCountFreshness(initial, observe()), initial);
    assert.equal(
      transitionCountFreshness(
        initial,
        observe({ page: { ...page, repository: "octocat/unrelated" }, listCompleted: true })
      ),
      initial
    );
  }
  const unsupported = { phase: "stale" as const, page: { repository: null, query: page.query } };
  assert.equal(
    transitionCountFreshness(unsupported, observe({ page: unsupported.page, listCompleted: true })),
    unsupported
  );
});

test("list completion preserves zero-count eligibility without requiring a changed number", () => {
  const initial = transitionCountFreshness(count(), { type: "navigation-start" });
  const pending = transitionCountFreshness(initial, observe({ busy: true }));
  const next = transitionCountFreshness(pending, observe({ listCompleted: true }));
  assert.equal(next.phase, "fresh");
  // The machine establishes freshness; the adapter can still display the same '0'.
  assert.deepEqual(next.page, page);
});
