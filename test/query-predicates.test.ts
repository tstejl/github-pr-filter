import * as assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { PREDICATE_REGISTRY, viewQueryKey } from "../src/query-predicates";
import {
  createDefaultViewLayout,
  matchSavedView,
  viewDestinationUrl,
  type SavedView
} from "../src/saved-views";

function equal(left: string, right: string): void {
  assert.equal(viewQueryKey(left), viewQueryKey(right), `${left} should match ${right}`);
}
function different(left: string, right: string): void {
  assert.notEqual(
    viewQueryKey(left),
    viewQueryKey(right),
    `${left} must remain distinct from ${right}`
  );
}
function permutations(terms: readonly string[]): string[][] {
  return terms.length
    ? terms.flatMap((term, index) =>
        permutations(terms.filter((_, i) => i !== index)).map((rest) => [term].concat(rest))
      )
    : [[]];
}
function saved(
  query: string,
  id = "custom",
  destination: SavedView["destination"] = "repository"
): SavedView {
  return {
    type: "view",
    id,
    name: id,
    description: "",
    query,
    icon: "filter",
    visible: true,
    destination
  };
}
const defaults = createDefaultViewLayout().entries.flatMap((entry) =>
  entry.type === "view" ? [{ scope: "octocat/repo", view: entry }] : []
);

// These expectations are specified independently of the registry's data.
describe("verified positive aliases", () => {
  for (const [left, right] of [
    ["is:pr", "type:pr"],
    ["is:issue", "type:issue"],
    ["is:pr is:open", "state:open type:pr"],
    ["is:pr is:closed", "state:closed type:pr"],
    ["is:pr is:merged", "state:merged type:pr"],
    ["is:pr draft:true", "is:draft type:pr"],
    ["is:pr draft:true", "state:draft type:pr"],
    ["author:@me is:pr is:draft", "type:pr draft:true author:@me"],
    ["is:pr AND state:open AND author:@me", "author:@me is:open type:pr"],
    ["  is:pr\tstate:open\n", "type:pr is:open"]
  ] as const) {
    test(`${left} = ${right}`, () => equal(left, right));
  }
});

describe("distinct predicate dimensions", () => {
  for (const [left, right] of [
    ["is:pr", "is:issue"],
    ["is:open", "is:closed"],
    ["is:merged", "is:unmerged"],
    ["is:closed", "is:merged"],
    ["is:open", "is:unmerged"],
    ["is:draft", "is:open is:draft"],
    ["draft:false", "is:open"],
    ["is:archived", "archived:true"],
    ["is:blocked", "is:blocking"],
    ["is:blocking", "blocking:true"],
    ["is:queued", "status:queued"],
    ["is:locked", "is:private"],
    ["has:assignee", "assignee:present"],
    ["no:assignee", "assignee:absent"],
    ["has:assignee", "assignee:*"],
    ["no:assignee", "-assignee:*"],
    ["no:label", "has:label"]
  ] as const) {
    test(`${left} != ${right}`, () => different(left, right));
  }
});

describe("unverified aliases and negation stay literal", () => {
  for (const [left, right] of [
    ["draft:yes", "draft:true"],
    ["draft:no", "draft:false"],
    ["archived:yes", "archived:true"],
    ["sort:updated", "sort:updated-desc"],
    ["org:github", "organization:github"],
    ["is:pull-request", "is:pr"],
    ["type:pull-request", "type:pr"],
    ["-is:open", "-state:open"],
    ["-is:closed", "-state:closed"],
    ["-is:merged", "-state:merged"],
    ["-is:pr", "-type:pr"],
    ["-is:draft", "draft:false"],
    ["-draft:true", "draft:false"],
    ["-is:locked", "is:unlocked"],
    ["-no:assignee", "has:assignee"],
    ["state:open", "-state:open"],
    ["draft:true", "draft:TRUE"],
    ["is:open", "IS:OPEN"],
    ["is:open", 'is:"open"']
  ] as const) {
    test(`${left} != ${right}`, () => different(left, right));
  }
  test("the same negative spelling can move past independent predicates", () => {
    equal("is:pr -author:@me -review:approved", "-review:approved type:pr -author:@me");
  });
});

test("all permutations of independent overloaded is predicates match", () => {
  const terms = ["is:pr", "is:locked", "is:queued", "is:blocked", "is:blocking"];
  for (const order of permutations(terms)) equal(terms.join(" "), order.join(" "));
});

test("the coworker query matches shuffled qualifiers and positive aliases", () => {
  const original =
    "is:pr is:open draft:false -review:approved -author:@me org:Cartesian-Systems sort:updated-desc";
  const terms = [
    "type:pr",
    "state:open",
    "draft:false",
    "-review:approved",
    "-author:@me",
    "org:Cartesian-Systems",
    "sort:updated-desc"
  ];
  for (let index = 0; index < terms.length; index++)
    equal(original, [...terms.slice(index), ...terms.slice(0, index)].join(" "));
  equal(original, terms.toReversed().join(" "));
});

describe("repetition and collision groups preserve ordering and multiplicity", () => {
  for (const [left, right] of [
    ["is:open state:closed", "state:closed is:open"],
    ["is:closed is:unmerged", "is:unmerged is:closed"],
    ["is:open is:merged", "is:merged is:open"],
    ["is:pr -type:pr", "-type:pr is:pr"],
    ["label:bug label:wip", "label:wip label:bug"],
    ["review:required review:approved", "review:approved review:required"],
    ["sort:created-asc sort:updated-desc", "sort:updated-desc sort:created-asc"],
    ["assignee:@me no:assignee", "no:assignee assignee:@me"],
    ["label:bug label:bug", "label:bug"],
    ["is:pr type:pr", "is:pr"],
    ["label:bug label:wip", "label:bug AND label:wip"]
  ] as const) {
    test(`${left} != ${right}`, () => different(left, right));
  }
  test("independent terms can move around an unchanged repeated group", () => {
    equal("is:pr label:bug author:@me label:wip", "author:@me label:bug label:wip type:pr");
  });
  test("explicit AND with repeated groups keeps the full sequence", () => {
    different("is:pr AND label:bug AND label:wip", "label:bug AND label:wip AND type:pr");
    equal("is:pr AND label:bug AND label:wip", "type:pr AND label:bug AND label:wip");
  });
});

test("state aliases checked alone do not rewrite interacting lifecycle expressions", () => {
  for (const [left, right] of [
    ["state:open state:draft", "state:open draft:true"],
    ["state:draft state:open", "draft:true state:open"],
    ["state:open state:merged", "state:open is:merged"],
    ["state:merged draft:false", "is:merged draft:false"],
    ["state:merged -is:open", "is:merged -is:open"],
    ["state:draft is:open", "state:draft state:open"],
    ["state:merged is:open", "state:merged state:open"],
    ["-state:draft state:open", "state:open -state:draft"],
    ["state:draft draft:true", "draft:true draft:true"],
    ["(state:open OR state:merged)", "(state:open OR is:merged)"],
    ["state:merged state:future", "is:merged state:future"]
  ] as const)
    different(left, right);
});

test("single predicates collide only for the explicitly reviewed alias groups", () => {
  const aliases = [
    ["is:pr", "type:pr"],
    ["is:issue", "type:issue"],
    ["is:open", "state:open"],
    ["is:closed", "state:closed"],
    ["is:merged", "state:merged"],
    ["draft:true", "is:draft", "state:draft"]
  ].map((group) => group.toSorted());
  const buckets = new Map<string, Set<string>>();
  for (const family of PREDICATE_REGISTRY)
    for (const form of family.forms) {
      const values =
        form.values === "opaque"
          ? ["true", "false", "present", "absent", "*", "value"]
          : Object.keys(form.values);
      for (const value of values)
        for (const sign of ["", "-"]) {
          const atom = `${sign}${form.qualifier}:${value}`;
          const key = viewQueryKey(atom);
          const bucket = buckets.get(key) ?? new Set<string>();
          bucket.add(atom);
          buckets.set(key, bucket);
        }
    }
  const collisions = [...buckets.values()]
    .filter((bucket) => bucket.size > 1)
    .map((bucket) => [...bucket].toSorted());
  assert.deepEqual(
    collisions.toSorted((a, b) => a[0]!.localeCompare(b[0]!)),
    aliases.toSorted((a, b) => a[0]!.localeCompare(b[0]!))
  );
});

test("unknown qualifiers and unsupported values fall back to exact text", () => {
  for (const query of [
    "is:pr future:value",
    "is:pr is:future",
    "is:pr state:future",
    "is:pr review:future",
    "is:pr field.priority:high",
    'type:"Bug"',
    "is:pr plain-text",
    "is:pr --author:@me",
    "is:__proto__",
    "state:constructor",
    "is:open:closed"
  ]) {
    assert.equal(viewQueryKey(query), `exact:${query}`);
    const terms = query.split(" ");
    if (terms.length > 1) different(query, terms.toReversed().join(" "));
  }
  different("is:open future:value", "state:open future:value");
});

test("Boolean and grouped expressions retain operators, grouping, and branch order", () => {
  equal("is:pr (is:open OR is:closed)", "type:pr (state:open OR state:closed)");
  for (const [left, right] of [
    ["is:pr (is:open OR is:closed)", "(is:open OR is:closed) is:pr"],
    ["is:open OR is:closed", "is:closed OR is:open"],
    ["is:pr AND (is:open OR is:closed)", "(is:pr AND is:open) OR is:closed"],
    ["is:pr (is:open)", "is:pr is:open"],
    ["is:pr (is:open)", "is:pr ( is:open )"],
    ["is:pr OR is:open", "is:pr or is:open"]
  ] as const)
    different(left, right);
});

test("malformed queries stay byte-stable and never throw", () => {
  for (const query of [
    'is:pr label:"unfinished',
    "is:pr (is:open OR",
    "is:pr ()",
    "is:pr AND",
    "is:pr )",
    "is:pr (state:draft"
  ]) {
    assert.equal(viewQueryKey(query), `exact:${query}`);
  }
});

test("opaque values preserve case, delimiters, escaped quotes, and term contents", () => {
  const values = [
    '"needs review"',
    '"is:open"',
    '"draft:true"',
    '"a\\\"b"',
    '"(bug OR draft)"',
    '"a:b,c"',
    "bug,wip",
    "*",
    '""'
  ];
  for (const value of values) {
    equal(`is:pr label:${value}`, `label:${value} type:pr`);
  }
  for (const [left, right] of [
    ['label:"is:open"', 'label:"state:open"'],
    ['label:"Bug"', 'label:"bug"'],
    ['label:"a b"', 'label:"a  b"'],
    ['label:"bug"', "label:bug"],
    ["label:bug,wip", "label:wip,bug"],
    ["created:2026-01-01..2026-02-01", "created:2026-02-01..2026-01-01"]
  ] as const)
    different(left, right);
});

test("default views recognize aliases without inferring extra lifecycle terms", () => {
  for (const [query, builtin] of [
    ["type:pr state:open", "open"],
    ["type:pr state:closed", "closed"],
    ["type:pr state:merged", "merged"],
    ["type:pr is:open is:draft", "draft"],
    ["review:required draft:false state:open type:pr", "needs_review"],
    ["type:pr draft:false state:open", "ready"],
    ["type:pr", "all"]
  ] as const)
    assert.equal(matchSavedView(query, defaults)?.view.builtin, builtin);
  assert.equal(matchSavedView("is:pr is:draft", defaults), null);
  assert.equal(matchSavedView("is:pr is:unmerged", defaults), null);
  assert.equal(matchSavedView("", defaults)?.view.builtin, "open");
});

test("exact matching wins and search destinations stay separate", () => {
  const alias = saved("is:pr is:open", "alias");
  const exact = saved("type:pr state:open", "exact");
  const dashboard = saved("type:pr state:open", "dashboard", "dashboard");
  const candidates = [alias, dashboard, exact].map((view) => ({ scope: "global", view }));
  assert.equal(matchSavedView(exact.query, candidates)?.view, exact);
  assert.equal(matchSavedView("state:open type:pr", candidates)?.view, alias);
  assert.equal(matchSavedView(exact.query, candidates, "dashboard")?.view, dashboard);
});

test("recognition never rewrites a stored query or either navigation URL", () => {
  const query = 'type:pr  state:open label:"is:draft" -author:@me sort:updated-desc';
  const view = Object.freeze(saved(query));
  const candidate = Object.freeze({ scope: "global", view });
  assert.equal(
    matchSavedView('sort:updated-desc -author:@me label:"is:draft" is:open is:pr', [candidate])
      ?.view,
    view
  );
  for (const destination of ["repository", "dashboard"] as const) {
    const url = viewDestinationUrl(
      { ...view, destination },
      "octocat/repo",
      "https://github.com/octocat/repo/pulls?q=old&page=4"
    );
    assert.equal(new URL(url!).searchParams.get("q"), query);
  }
  assert.equal(view.query, query);
});
