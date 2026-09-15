import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { analyzeIssueQuery, rewriteIssueQuery } from "../src/issue-query";

const input = (source: string) => ({ source });

test("issue queries default empty input to Open and explicit type-only input to All", () => {
  assert.deepEqual(analyzeIssueQuery(input("")).selection, {
    kind: "preset",
    lifecycle: "open"
  });
  assert.deepEqual(analyzeIssueQuery(input("is:issue")).selection, {
    kind: "preset",
    lifecycle: "all"
  });
});

test("issue planner recognizes flat state filters and preserves unrelated terms", () => {
  const source = "is:issue label:bug state:open";
  assert.deepEqual(analyzeIssueQuery(input(source)).selection, {
    kind: "preset",
    lifecycle: "open"
  });
  const closed = rewriteIssueQuery(input(source), "closed");
  assert.equal(closed.kind, "rewritten");
  if (closed.kind === "rewritten") {
    assert.equal(closed.input.source, "is:issue label:bug state:closed");
  }
  const all = rewriteIssueQuery(input(source), "all");
  assert.equal(all.kind, "rewritten");
  if (all.kind === "rewritten") {
    assert.equal(all.input.source, "is:issue label:bug");
  }
});

test("issue All transitions never inject pull-request qualifiers", () => {
  const all = rewriteIssueQuery(input("is:issue state:open"), "all");
  assert.equal(all.kind, "rewritten");
  if (all.kind === "rewritten") {
    assert.equal(all.input.source, "is:issue");
    assert.equal(all.input.source.includes("is:pr"), false);
  }
  const fromEmpty = rewriteIssueQuery(input(""), "all");
  assert.equal(fromEmpty.kind, "rewritten");
  if (fromEmpty.kind === "rewritten") {
    assert.equal(fromEmpty.input.source, "is:issue");
  }
});

test("issue planner fails closed for Boolean queries and unsupported status dimensions", () => {
  for (const source of [
    "is:issue state:open OR state:closed",
    "is:issue is:merged",
    "is:issue draft:true",
    "is:pr state:open",
    "-is:issue state:open"
  ]) {
    const analysis = analyzeIssueQuery(input(source));
    assert.equal(analysis.safeToRewrite, false, source);
    assert.equal(rewriteIssueQuery(input(source), "closed").kind, "unsafe", source);
  }
});

test("safe issue rewrites keep the issue collection explicit", () => {
  const rewrite = rewriteIssueQuery(input("label:bug"), "closed");
  assert.equal(rewrite.kind, "rewritten");
  if (rewrite.kind === "rewritten") {
    assert.equal(rewrite.input.source, "is:issue label:bug state:closed");
  }
});
