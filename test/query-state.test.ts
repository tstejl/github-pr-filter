import { test } from "bun:test";
import * as assert from "node:assert/strict";
import * as queryState from "../src/query-state";

const REVIEW_STATUSES = ["none", "required", "approved", "changes_requested"] as const;

test("tokenizeQuery preserves quoted search terms", () => {
  assert.deepEqual(queryState.tokenizeQuery('is:pr label:"ready for review" "exact phrase"'), [
    "is:pr",
    'label:"ready for review"',
    '"exact phrase"'
  ]);
});

test("Open means all open pull requests including drafts", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:closed draft:true label:frontend", "open"),
    "is:pr label:frontend is:open"
  );
});

test("Ready adds the canonical non-draft qualifier", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:open draft:true author:octocat", "ready"),
    "is:pr author:octocat is:open draft:false"
  );
});

test("Draft replaces state and legacy readiness qualifiers", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr state:closed -is:draft review:approved", "draft"),
    "is:pr review:approved is:open draft:true"
  );
});

test("Closed includes merged pull requests", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:open draft:false assignee:@me", "closed"),
    "is:pr assignee:@me is:closed"
  );
});

test("Closed without merging adds the unmerged qualifier", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:open draft:false assignee:@me", "closed_unmerged"),
    "is:pr assignee:@me is:closed is:unmerged"
  );
});

test("Merged is separate from unmerged Closed", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:closed is:unmerged label:shipped", "merged"),
    "is:pr label:shipped is:merged"
  );
});

test("Needs review adds open, non-draft, and unreviewed qualifiers", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:open label:frontend", "needs_review"),
    "is:pr label:frontend is:open draft:false -review:approved -review:changes_requested"
  );
});

test("Needs review replaces review-status filters but keeps reviewer filters", () => {
  assert.equal(
    queryState.queryWithLifecycle(
      "is:pr is:open review:approved reviewed-by:octocat label:frontend",
      "needs_review"
    ),
    "is:pr reviewed-by:octocat label:frontend is:open draft:false -review:approved -review:changes_requested"
  );
});

test("leaving Needs review removes its review qualifiers", () => {
  assert.equal(
    queryState.queryWithLifecycle(
      "is:pr is:open draft:false -review:approved -review:changes_requested label:bug",
      "draft"
    ),
    "is:pr label:bug is:open draft:true"
  );
});

test("a needs-review query updates the displayed selection", () => {
  assert.deepEqual(
    queryState.reconcileQuery(
      "is:pr is:open draft:false -review:approved -review:changes_requested"
    ),
    {
      query: "is:pr is:open draft:false -review:approved -review:changes_requested",
      effective: { lifecycle: "needs_review" }
    }
  );
});

test("closed state takes precedence over needs-review qualifiers", () => {
  assert.equal(
    queryState.inspectQuery(
      "is:pr is:closed draft:false -review:approved -review:changes_requested"
    ).lifecycle,
    "closed"
  );
});

test("a partial needs-review query still maps to Ready", () => {
  assert.equal(
    queryState.inspectQuery("is:pr is:open draft:false -review:approved").lifecycle,
    "ready"
  );
});

test("lifecycle changes preserve GitHub native review filters", () => {
  assert.equal(
    queryState.queryWithLifecycle(
      "is:pr is:open review:changes_requested reviewed-by:octocat label:frontend",
      "ready"
    ),
    "is:pr review:changes_requested reviewed-by:octocat label:frontend is:open draft:false"
  );
});

test("GitHub review statuses remain orthogonal to non-draft lifecycle", () => {
  for (const reviewStatus of REVIEW_STATUSES) {
    const query = `is:pr is:open draft:false review:${reviewStatus}`;
    assert.equal(queryState.inspectQuery(query).lifecycle, "ready");
    assert.equal(
      queryState.queryWithLifecycle(query, "draft"),
      `is:pr review:${reviewStatus} is:open draft:true`
    );
  }
});

test("review status alone does not imply non-draft readiness", () => {
  for (const reviewStatus of REVIEW_STATUSES) {
    assert.equal(queryState.inspectQuery(`is:pr is:open review:${reviewStatus}`).lifecycle, "open");
  }
});

test("reviewer-specific qualifiers survive lifecycle changes", () => {
  const reviewerQualifiers = [
    "reviewed-by:octocat",
    "review-requested:hubot",
    "user-review-requested:@me",
    "team-review-requested:github/docs"
  ].join(" ");

  assert.equal(
    queryState.queryWithLifecycle(`is:pr is:open draft:false ${reviewerQualifiers}`, "closed"),
    `is:pr ${reviewerQualifiers} is:closed`
  );
});

test("a plain open query maps to Open without being rewritten", () => {
  assert.deepEqual(queryState.reconcileQuery("is:pr is:open"), {
    query: "is:pr is:open",
    effective: { lifecycle: "open" }
  });
});

test("state:open without is:pr maps to Open without being rewritten", () => {
  assert.deepEqual(queryState.reconcileQuery("state:open label:bug"), {
    query: "state:open label:bug",
    effective: { lifecycle: "open" }
  });
});

test("lifecycle changes replace state:open without inventing is:pr", () => {
  assert.equal(
    queryState.queryWithLifecycle("state:open label:bug", "ready"),
    "label:bug is:open draft:false"
  );
});

test("explicit draft view updates the displayed selection", () => {
  assert.deepEqual(queryState.reconcileQuery("is:pr is:open draft:true"), {
    query: "is:pr is:open draft:true",
    effective: { lifecycle: "draft" }
  });
});

test("state:closed without is:pr updates the displayed selection", () => {
  assert.deepEqual(queryState.reconcileQuery("state:closed label:bug"), {
    query: "state:closed label:bug",
    effective: { lifecycle: "closed" }
  });
});

test("closed state takes precedence without rewriting contradictory qualifiers", () => {
  assert.deepEqual(queryState.reconcileQuery("is:pr is:closed draft:true"), {
    query: "is:pr is:closed draft:true",
    effective: { lifecycle: "closed" }
  });
});

test("closed and unmerged query maps to Closed without merging", () => {
  assert.deepEqual(queryState.reconcileQuery("is:pr is:closed is:unmerged label:bug"), {
    query: "is:pr is:closed is:unmerged label:bug",
    effective: { lifecycle: "closed_unmerged" }
  });
});

test("explicit merged view updates the displayed selection", () => {
  assert.deepEqual(queryState.reconcileQuery("is:pr is:merged label:shipped"), {
    query: "is:pr is:merged label:shipped",
    effective: { lifecycle: "merged" }
  });
});

test("legacy draft syntax is recognized", () => {
  assert.equal(queryState.inspectQuery("is:pr is:draft").lifecycle, "draft");
  assert.equal(queryState.inspectQuery("is:pr -is:draft").lifecycle, "ready");
});
