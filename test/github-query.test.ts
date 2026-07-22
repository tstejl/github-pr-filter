import { test } from "bun:test";
import * as assert from "node:assert/strict";
import {
  combineQueryExpressions,
  createQueryAtom,
  hasOuterAttachedParenthesis,
  parseGitHubQuery,
  serializeGitHubQuery,
  type JunctionExpression
} from "../src/github-query";

test("preserves quoted qualifier values and exact atom text", () => {
  const document = parseGitHubQuery('is:pr label:"ready for review" "Exact Phrase"');

  assert.deepEqual(document.diagnostics, []);
  assert.equal(
    serializeGitHubQuery(document.root),
    'is:pr label:"ready for review" "Exact Phrase"'
  );
  assert.deepEqual(
    document.tokens.filter((token) => token.kind === "atom").map((token) => token.raw),
    ["is:pr", 'label:"ready for review"', '"Exact Phrase"']
  );
});

test("recognizes only uppercase AND and OR outside quotes", () => {
  const document = parseGitHubQuery('label:"A AND B" and OR author:octocat');

  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root?.kind, "or");
  assert.equal(serializeGitHubQuery(document.root), 'label:"A AND B" and OR author:octocat');
});

test("represents whitespace-separated terms as implicit AND", () => {
  const document = parseGitHubQuery("is:pr\tstate:open  label:bug");

  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root?.kind, "and");
  const root = document.root as JunctionExpression;
  assert.deepEqual(
    root.links.map((link) => ({ operator: link.operator, style: link.style, raw: link.raw })),
    [
      { operator: "and", style: "implicit", raw: "\t" },
      { operator: "and", style: "implicit", raw: "  " }
    ]
  );
  assert.equal(serializeGitHubQuery(document.root), "is:pr state:open label:bug");
});

test("parses AND with higher precedence than OR", () => {
  const document = parseGitHubQuery("label:a OR author:b AND assignee:c");

  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root?.kind, "or");
  if (document.root?.kind !== "or") {
    assert.fail("expected an OR expression");
  }
  assert.equal(document.root.terms[0]?.kind, "atom");
  assert.equal(document.root.terms[1]?.kind, "and");
  assert.equal(serializeGitHubQuery(document.root), "label:a OR author:b AND assignee:c");
});

test("preserves explicit groups while parsing operators inside them", () => {
  const document = parseGitHubQuery("is:open AND (label:a OR label:b)");

  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root?.kind, "and");
  if (document.root?.kind !== "and") {
    assert.fail("expected an AND expression");
  }
  assert.equal(document.root.links[0]?.style, "explicit");
  assert.equal(document.root.terms[1]?.kind, "group");
  assert.equal(serializeGitHubQuery(document.root), "is:open AND (label:a OR label:b)");
});

test("serializer inserts parentheses when a rebuilt OR is placed under AND", () => {
  const eitherLabel = combineQueryExpressions("or", [
    createQueryAtom("label:a"),
    createQueryAtom("label:b")
  ]);
  assert.notEqual(eitherLabel, null);

  const expression = combineQueryExpressions("and", [
    eitherLabel as NonNullable<typeof eitherLabel>,
    createQueryAtom("is:open")
  ]);

  assert.equal(serializeGitHubQuery(expression), "(label:a OR label:b) is:open");
});

test("serializer does not add unnecessary parentheses around AND under OR", () => {
  const labelAndAuthor = combineQueryExpressions("and", [
    createQueryAtom("label:a"),
    createQueryAtom("author:b")
  ]);
  assert.notEqual(labelAndAuthor, null);

  const expression = combineQueryExpressions("or", [
    labelAndAuthor as NonNullable<typeof labelAndAuthor>,
    createQueryAtom("assignee:c")
  ]);

  assert.equal(serializeGitHubQuery(expression), "label:a author:b OR assignee:c");
});

test("keeps parentheses and operators inside escaped quoted text opaque", () => {
  const query = 'label:"a \\"quoted\\" (AND OR) value" is:open';
  const document = parseGitHubQuery(query);

  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root?.kind, "and");
  assert.equal(serializeGitHubQuery(document.root), query);
});

test("keeps apostrophes inside ordinary search terms opaque", () => {
  const query = "is:pr is:open don't";
  const document = parseGitHubQuery(query);

  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root?.kind, "and");
  assert.equal(serializeGitHubQuery(document.root), query);
  assert.deepEqual(
    document.tokens.filter((token) => token.kind === "atom").map((token) => token.raw),
    ["is:pr", "is:open", "don't"]
  );
});

test("reports an unterminated quote without throwing", () => {
  const document = parseGitHubQuery('is:pr label:"unfinished value');

  assert.deepEqual(
    document.diagnostics.map((diagnostic) => diagnostic.code),
    ["unterminated-quote"]
  );
  assert.equal(serializeGitHubQuery(document.root), 'is:pr label:"unfinished value');
});

test("reports dangling operators", () => {
  for (const query of ["is:open AND", "is:open OR"]) {
    const document = parseGitHubQuery(query);
    assert.equal(
      document.diagnostics.some((diagnostic) => diagnostic.code === "missing-operand"),
      true
    );
  }
});

test("reports unmatched and empty parentheses", () => {
  const unmatchedOpen = parseGitHubQuery("is:open AND (label:a OR label:b");
  const unmatchedClose = parseGitHubQuery("is:open)");
  const emptyGroup = parseGitHubQuery("is:open ()");

  assert.equal(
    unmatchedOpen.diagnostics.some((diagnostic) => diagnostic.code === "unmatched-parenthesis"),
    true
  );
  assert.equal(
    unmatchedClose.diagnostics.some((diagnostic) => diagnostic.code === "unmatched-parenthesis"),
    true
  );
  assert.equal(
    emptyGroup.diagnostics.some((diagnostic) => diagnostic.code === "empty-group"),
    true
  );
});

test("an empty query is valid and has no expression", () => {
  const document = parseGitHubQuery("  \t");

  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root, null);
  assert.equal(serializeGitHubQuery(document.root), "");
});

test("distinguishes grouping from parentheses attached to opaque text", () => {
  assert.equal(hasOuterAttachedParenthesis(parseGitHubQuery("(label:bug OR label:docs)")), false);
  for (const source of ["foo(bar)", "(bar)foo", "is:open(review:approved)"]) {
    assert.equal(hasOuterAttachedParenthesis(parseGitHubQuery(source)), true, source);
  }
});
