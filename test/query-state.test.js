const test = require("node:test");
const assert = require("node:assert/strict");

const queryState = require("../src/query-state.js");

test("tokenizeQuery preserves quoted search terms", () => {
  assert.deepEqual(
    queryState.tokenizeQuery('is:pr label:"ready for review" "exact phrase"'),
    ["is:pr", 'label:"ready for review"', '"exact phrase"']
  );
});

test("All means open pull requests including drafts", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:closed draft:true label:frontend", "all"),
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

test("Closed means closed without merging", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:open draft:false assignee:@me", "closed"),
    "is:pr assignee:@me is:closed is:unmerged"
  );
});

test("Merged is separate from unmerged Closed", () => {
  assert.equal(
    queryState.queryWithLifecycle("is:pr is:closed is:unmerged label:shipped", "merged"),
    "is:pr label:shipped is:merged"
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

test("stored lifecycle wins over GitHub's default plain open query", () => {
  assert.deepEqual(
    queryState.reconcileQuery("is:pr is:open", { lifecycle: "ready" }),
    {
      query: "is:pr is:open draft:false",
      preferences: { lifecycle: "ready" },
      effective: { lifecycle: "ready" }
    }
  );
});

test("explicit draft view updates the persisted selection", () => {
  assert.deepEqual(
    queryState.reconcileQuery("is:pr is:open draft:true", { lifecycle: "ready" }),
    {
      query: "is:pr is:open draft:true",
      preferences: { lifecycle: "draft" },
      effective: { lifecycle: "draft" }
    }
  );
});

test("explicit closed view updates the persisted selection", () => {
  assert.deepEqual(
    queryState.reconcileQuery("is:pr state:closed label:bug", { lifecycle: "draft" }),
    {
      query: "is:pr label:bug is:closed is:unmerged",
      preferences: { lifecycle: "closed" },
      effective: { lifecycle: "closed" }
    }
  );
});

test("explicit merged view updates the persisted selection", () => {
  assert.deepEqual(
    queryState.reconcileQuery("is:pr is:merged label:shipped", { lifecycle: "closed" }),
    {
      query: "is:pr label:shipped is:merged",
      preferences: { lifecycle: "merged" },
      effective: { lifecycle: "merged" }
    }
  );
});

test("legacy draft syntax is recognized", () => {
  assert.equal(queryState.inspectQuery("is:pr is:draft").lifecycle, "draft");
  assert.equal(queryState.inspectQuery("is:pr -is:draft").lifecycle, "ready");
});

test("old multi-filter preferences migrate safely to All", () => {
  assert.deepEqual(
    queryState.sanitizePreferences({ readiness: "draft", personalReview: "reviewed" }),
    { lifecycle: "all" }
  );
});
