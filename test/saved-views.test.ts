import * as assert from "node:assert/strict";
import { test } from "bun:test";
import {
  createDefaultViewLayout,
  matchSavedView,
  migrateLifecycleLayout,
  viewDestinationUrl,
  viewQueryKey,
  visibleViewEntries,
  type SavedView,
  type ViewLayout
} from "../src/saved-views";
import { DEFAULT_LIFECYCLE_LAYOUT } from "../src/lifecycle-layout";

function view(query: string, overrides: Partial<SavedView> = {}): SavedView {
  return {
    type: "view",
    id: "saved-view",
    name: "Saved view",
    description: "",
    query,
    icon: "filter",
    visible: true,
    destination: "repository",
    ...overrides
  };
}

test("query recognition allows shuffled qualifiers and retains repeated qualifiers", () => {
  const candidate = view("is:pr is:open review:required");
  const found = matchSavedView("review:required is:open is:pr", [
    { scope: "octocat/repo", view: candidate }
  ]);
  assert.equal(found?.view, candidate);

  assert.notEqual(
    viewQueryKey("is:pr review:required review:approved"),
    viewQueryKey("review:approved is:pr review:required")
  );
});

test("quoted qualifier values remain intact during matching and navigation", () => {
  const savedQuery = 'is:pr label:"needs review"';
  const found = matchSavedView('label:"needs review" is:pr', [
    { scope: "octocat/repo", view: view(savedQuery) }
  ]);
  assert.equal(found?.view.query, savedQuery);
  const url = viewDestinationUrl(view(savedQuery), "octocat/repo");
  assert.equal(new URL(url ?? "https://github.com").searchParams.get("q"), savedQuery);
});

test("GitHub state aliases recognize default views without changing saved queries", () => {
  const candidates = createDefaultViewLayout().entries.flatMap((entry) =>
    entry.type === "view" ? [{ scope: "octocat/repo", view: entry }] : []
  );
  for (const [query, builtin] of [
    ["is:pr state:open", "open"],
    ["state:closed is:pr", "closed"],
    ["draft:false state:open is:pr", "ready"],
    ["review:required is:pr state:open draft:false", "needs_review"],
    ["state:open draft:true is:pr", "draft"],
    ["is:pr state:closed is:unmerged", "closed_unmerged"]
  ]) {
    assert.equal(matchSavedView(query!, candidates)?.view.builtin, builtin);
    const previousSpelling = query!
      .replaceAll("state:open", "is:open")
      .replaceAll("state:closed", "is:closed");
    assert.equal(matchSavedView(previousSpelling, candidates)?.view.builtin, builtin);
  }
  const savedQuery = "state:open is:pr -author:@me";
  const saved = view(savedQuery);
  assert.equal(
    matchSavedView("-author:@me is:pr is:open", [{ scope: "global", view: saved }])?.view,
    saved
  );
  const url = viewDestinationUrl(saved, "octocat/repo");
  assert.equal(new URL(url!).searchParams.get("q"), savedQuery);
});

test("state aliases preserve Boolean structure, quoted text, and negation", () => {
  assert.equal(
    viewQueryKey("is:pr (is:open OR is:closed)"),
    viewQueryKey("is:pr (state:open OR state:closed)")
  );
  assert.notEqual(
    viewQueryKey("is:pr (state:open OR state:closed)"),
    viewQueryKey("(state:open OR state:closed) is:pr")
  );
  for (const [left, right] of [
    ['is:pr label:"is:open"', 'is:pr label:"state:open"'],
    ["is:pr -is:open", "is:pr -state:open"],
    ["is:pr -is:closed", "is:pr -state:closed"]
  ]) {
    assert.notEqual(viewQueryKey(left!), viewQueryKey(right!));
  }
});

test("Boolean expressions and malformed queries use exact matching", () => {
  const expression = "is:pr (is:open OR is:closed)";
  assert.notEqual(viewQueryKey(expression), viewQueryKey("(is:open OR is:closed) is:pr"));
  const malformed = "is:pr (is:open OR";
  assert.equal(viewQueryKey(malformed), `exact:${malformed}`);
  assert.equal(
    matchSavedView(malformed, [{ scope: "global", view: view(malformed) }])?.view.query,
    malformed
  );
  assert.equal(
    matchSavedView("is:pr OR is:open", [{ scope: "global", view: view("is:pr or is:open") }]),
    null
  );
});

test("conflicting lifecycle qualifiers preserve their original order", () => {
  assert.notEqual(
    viewQueryKey("is:open state:closed is:pr"),
    viewQueryKey("state:closed is:open is:pr")
  );
});

test("explicit AND with repeated qualifiers is not treated as a shuffled match", () => {
  const query = "is:pr AND review:required AND review:approved";
  const reversed = "review:approved AND is:pr AND review:required";
  assert.notEqual(viewQueryKey(query), viewQueryKey(reversed));
  assert.equal(matchSavedView(reversed, [{ scope: "global", view: view(query) }]), null);
});

test("navigation replaces raw query and removes pagination for repository and dashboard views", () => {
  const current = "https://github.com/octocat/repo/pulls?q=old&page=4&after=abc&drafts=1&locale=en";
  const repositoryUrl = new URL(
    viewDestinationUrl(view("is:pr is:open"), "octocat/repo", current) ?? "https://github.com"
  );
  assert.equal(repositoryUrl.pathname, "/octocat/repo/pulls");
  assert.equal(repositoryUrl.searchParams.get("q"), "is:pr is:open");
  assert.equal(repositoryUrl.searchParams.get("page"), null);
  assert.equal(repositoryUrl.searchParams.get("after"), null);
  assert.equal(repositoryUrl.searchParams.get("drafts"), "1");
  assert.equal(repositoryUrl.searchParams.get("locale"), "en");

  const destination = viewDestinationUrl(
    view("is:pr is:open", { destination: "dashboard" }),
    "octocat/repo",
    current
  );
  assert.ok(destination);
  assert.equal(new URL(destination).pathname, "/pulls");
  assert.equal(new URL(destination).searchParams.get("q"), "is:pr is:open");
  assert.equal(viewDestinationUrl(view("is:pr"), null), null);
});

test("suffix pages generate canonical view links and retain only same-repository display preferences", () => {
  const query = 'is:pr state:open label:"needs triage"';
  const saved = view(query);
  const current =
    "https://github.com/Owner/Repo/pulls/future/v2/opaque?q=old&page=3&cursor=old&display=compact";
  const url = new URL(viewDestinationUrl(saved, "owner/repo", current)!);
  assert.equal(url.pathname, "/owner/repo/pulls");
  assert.equal(url.searchParams.get("q"), query);
  assert.equal(url.searchParams.get("display"), "compact");
  assert.equal(url.searchParams.has("page"), false);
  assert.equal(url.searchParams.has("cursor"), false);
  for (const page of [
    "https://github.com/other/repo/pulls/future?display=compact",
    "https://evil.example/owner/repo/pulls/future?display=compact",
    "https://github.com/owner/repo/pull/123?display=compact"
  ])
    assert.equal(
      new URL(viewDestinationUrl(saved, "owner/repo", page)!).searchParams.has("display"),
      false
    );
});

test("hidden entries and adjacent dividers do not leave redundant separators", () => {
  const layout: ViewLayout = {
    version: 1,
    entries: [
      view("is:open", { id: "first" }),
      { type: "divider", id: "separator-before-hidden" },
      view("is:pr", { id: "hidden", visible: false }),
      { type: "divider", id: "separator-one" },
      { type: "divider", id: "separator-two" },
      view("is:open", { id: "visible" }),
      { type: "divider", id: "trailing" }
    ]
  };
  assert.deepEqual(
    visibleViewEntries(layout).map((entry) => entry.id),
    ["first", "separator-two", "visible"]
  );
});

test("lifecycle migration preserves entry order, visibility, and separators repeatedly", () => {
  const source = {
    ...DEFAULT_LIFECYCLE_LAYOUT,
    entries: DEFAULT_LIFECYCLE_LAYOUT.entries.map((entry) =>
      entry.type === "option" && entry.value === "draft"
        ? Object.assign({}, entry, { visible: false })
        : entry
    )
  };
  const migrated = migrateLifecycleLayout(source);
  assert.deepEqual(migrateLifecycleLayout(source), migrated);
  assert.equal(
    migrated.entries.some(
      (entry) => entry.type === "view" && entry.builtin === "draft" && !entry.visible
    ),
    true
  );
  assert.deepEqual(
    migrated.entries.map((entry) => (entry.type === "divider" ? "divider" : entry.builtin)),
    source.entries.map((entry) => (entry.type === "divider" ? "divider" : entry.value))
  );
  assert.equal(createDefaultViewLayout().version, 1);
});
