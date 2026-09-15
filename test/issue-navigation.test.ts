import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { createIssueNavigationPlan } from "../src/issue-navigation";

test("issue navigation preserves query parameter choice and page filters", () => {
  const plan = createIssueNavigationPlan({
    pageUrl: "https://github.com/octocat/hello-world/issues?query=is%3Aissue+state%3Aopen&page=3",
    input: { source: "is:issue state:open" },
    queryParameter: "query"
  });
  const all = new URL(plan.actionUrls.all ?? "");
  const closed = new URL(plan.actionUrls.closed ?? "");

  assert.equal(all.searchParams.get("query"), "is:issue");
  assert.equal(closed.searchParams.get("query"), "is:issue state:closed");
  assert.equal(all.searchParams.has("q"), false);
  assert.equal(all.searchParams.has("page"), false);
  assert.equal(plan.actionUrls.needs_review, null);
  assert.equal(plan.actionUrls.merged, null);
});
