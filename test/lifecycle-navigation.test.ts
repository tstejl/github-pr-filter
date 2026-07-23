import { test } from "bun:test";
import * as assert from "node:assert/strict";
import {
  createLifecycleActionUrls,
  createLifecycleNavigationPlan
} from "../src/lifecycle-navigation";

test("navigation derives every action from one immutable query context", () => {
  const plan = createLifecycleNavigationPlan({
    pageUrl: "https://github.com/octocat/hello-world/pulls?q=is%3Apr+is%3Aopen&page=3",
    input: { source: "is:pr is:open" },
    queryParameter: "q"
  });
  const { actionUrls } = plan;

  assert.deepEqual(plan.analysis.selection, { kind: "preset", lifecycle: "open" });
  assert.equal(new URL(actionUrls.all ?? "").searchParams.get("q"), "is:pr");
  assert.equal(new URL(actionUrls.draft ?? "").searchParams.get("q"), "is:pr is:open draft:true");
  assert.equal(new URL(actionUrls.draft ?? "").searchParams.has("page"), false);
});

test("navigation keeps GitHub's active query parameter flavor and removes the unused alias", () => {
  const actionUrls = createLifecycleActionUrls({
    pageUrl:
      "https://github.com/octocat/hello-world/pulls?query=state%3Aopen+label%3Abug&q=stale&page=2",
    input: { source: "state:open label:bug" },
    queryParameter: "query"
  });
  const closed = new URL(actionUrls.closed ?? "");

  assert.equal(closed.searchParams.get("query"), "label:bug is:closed");
  assert.equal(closed.searchParams.has("q"), false);
  assert.equal(closed.searchParams.has("page"), false);
});

test("blank GitHub defaults keep Open byte-stable while All becomes explicit", () => {
  const actionUrls = createLifecycleActionUrls({
    pageUrl: "https://github.com/octocat/hello-world/pulls",
    input: { source: "" },
    queryParameter: "q"
  });

  assert.equal(new URL(actionUrls.open ?? "").searchParams.has("q"), false);
  assert.equal(new URL(actionUrls.all ?? "").searchParams.get("q"), "is:pr");
});

test("flat Custom masks remain replaceable by every lifecycle preset", () => {
  const actionUrls = createLifecycleActionUrls({
    pageUrl: "https://github.com/octocat/hello-world/pulls?q=is%3Apr+draft%3Atrue",
    input: { source: "is:pr draft:true" },
    queryParameter: "q"
  });

  assert.equal(
    Object.values(actionUrls).every((url) => url !== null),
    true
  );
  assert.equal(new URL(actionUrls.all ?? "").searchParams.get("q"), "is:pr");
  assert.equal(new URL(actionUrls.closed ?? "").searchParams.get("q"), "is:pr is:closed");
});

test("review correlation disables only the transition that would own review terms", () => {
  const source = "is:open draft:false (-review:approved) (-review:changes_requested) label:bug";
  const actionUrls = createLifecycleActionUrls({
    pageUrl: `https://github.com/octocat/hello-world/pulls?q=${encodeURIComponent(source)}`,
    input: { source },
    queryParameter: "q"
  });

  assert.equal(actionUrls.needs_review, null);
  assert.notEqual(actionUrls.closed, null);
});

test("attached opaque parentheses preserve the current All view but disable mutations", () => {
  const source = "foo(bar)";
  const actionUrls = createLifecycleActionUrls({
    pageUrl: `https://github.com/octocat/hello-world/pulls?q=${encodeURIComponent(source)}`,
    input: { source },
    queryParameter: "q"
  });

  assert.equal(new URL(actionUrls.all ?? "").searchParams.get("q"), source);
  assert.equal(actionUrls.open, null);
  assert.equal(actionUrls.closed, null);
});

test("navigation disables every preset when lifecycle syntax cannot be rewritten safely", () => {
  const actionUrls = createLifecycleActionUrls({
    pageUrl: "https://github.com/octocat/hello-world/pulls?q=is%3Aopen+OR+is%3Aclosed",
    input: { source: "is:open OR is:closed" },
    queryParameter: "q"
  });

  assert.equal(
    Object.values(actionUrls).every((url) => url === null),
    true
  );
});
