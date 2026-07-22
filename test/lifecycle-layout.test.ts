import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { LIFECYCLES } from "../src/lifecycle";
import {
  addLifecycleDivider,
  createDefaultLifecycleLayout,
  lifecycleLayoutEntryKey,
  moveLifecycleLayoutEntry,
  placeLifecycleLayoutEntry,
  removeLifecycleDivider,
  setLifecycleVisibility,
  visibleLifecycleLayoutEntries
} from "../src/lifecycle-layout";
import { LIFECYCLE_OPTIONS } from "../src/lifecycle-options";

test("the UI catalog exhaustively represents the lifecycle domain", () => {
  assert.equal(LIFECYCLE_OPTIONS.length, LIFECYCLES.length);
  assert.deepEqual(new Set(LIFECYCLE_OPTIONS.map(({ value }) => value)), new Set(LIFECYCLES));
});

test("default layout places All in its own final section", () => {
  const layout = createDefaultLifecycleLayout();
  assert.equal(layout.version, 2);
  assert.equal(layout.entries.filter(({ type }) => type === "option").length, 8);
  assert.equal(layout.entries.filter(({ type }) => type === "divider").length, 3);
  assert.deepEqual(
    visibleLifecycleLayoutEntries(layout).map((entry) =>
      "type" in entry ? "divider" : entry.value
    ),
    [
      "needs_review",
      "divider",
      "open",
      "ready",
      "draft",
      "divider",
      "closed",
      "merged",
      "closed_unmerged",
      "divider",
      "all"
    ]
  );
});

test("hidden options are omitted and orphaned separators collapse", () => {
  let layout = createDefaultLifecycleLayout();
  layout = setLifecycleVisibility(layout, "all", false);
  layout = setLifecycleVisibility(layout, "needs_review", false);
  layout = setLifecycleVisibility(layout, "open", false);
  const visible = visibleLifecycleLayoutEntries(layout);
  assert.equal(visible[0] && "value" in visible[0] ? visible[0].value : null, "ready");
  assert.equal(visible.filter((entry) => "type" in entry).length, 1);
});

test("a hidden active option can be temporarily included without changing its preference", () => {
  const layout = setLifecycleVisibility(createDefaultLifecycleLayout(), "draft", false);
  const normallyVisible = visibleLifecycleLayoutEntries(layout);
  const visibleWhileActive = visibleLifecycleLayoutEntries(layout, LIFECYCLE_OPTIONS, "draft");
  assert.equal(
    normallyVisible.some((entry) => "value" in entry && entry.value === "draft"),
    false
  );
  assert.equal(
    visibleWhileActive.some((entry) => "value" in entry && entry.value === "draft"),
    true
  );
});

test("at least one option remains visible", () => {
  let layout = createDefaultLifecycleLayout();
  for (const option of LIFECYCLE_OPTIONS) {
    layout = setLifecycleVisibility(layout, option.value, false);
  }
  assert.deepEqual(
    layout.entries.flatMap((entry) =>
      entry.type === "option" && entry.visible ? [entry.value] : []
    ),
    ["all"]
  );
});

test("options and separators can be reordered, added, and removed", () => {
  let layout = createDefaultLifecycleLayout();
  const draft = layout.entries.find((entry) => entry.type === "option" && entry.value === "draft");
  assert.ok(draft);
  layout = moveLifecycleLayoutEntry(layout, lifecycleLayoutEntryKey(draft), -1);
  const draftIndex = layout.entries.findIndex(
    (entry) => entry.type === "option" && entry.value === "draft"
  );
  const readyIndex = layout.entries.findIndex(
    (entry) => entry.type === "option" && entry.value === "ready"
  );
  assert.ok(draftIndex < readyIndex);

  layout = addLifecycleDivider(layout);
  const added = layout.entries.at(-1);
  assert.equal(added?.type, "divider");
  if (added?.type === "divider") {
    layout = removeLifecycleDivider(layout, added.id);
  }
  assert.notEqual(layout.entries.at(-1)?.type, "divider");
});

test("a persisted custom separator cannot collide with a newly added separator", () => {
  let layout = addLifecycleDivider(createDefaultLifecycleLayout());
  const persistedIds = layout.entries
    .filter((entry) => entry.type === "divider")
    .map((entry) => entry.id);
  layout = addLifecycleDivider(layout);
  const ids = layout.entries.filter((entry) => entry.type === "divider").map((entry) => entry.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, persistedIds.length), persistedIds);
});

test("option and divider editor keys occupy separate namespaces", () => {
  assert.equal(
    lifecycleLayoutEntryKey({ type: "option", value: "open", visible: true }),
    "option:open"
  );
  assert.equal(
    lifecycleLayoutEntryKey({ type: "divider", id: "option-open" }),
    "divider:option-open"
  );
  assert.notEqual(
    lifecycleLayoutEntryKey({ type: "option", value: "open", visible: true }),
    lifecycleLayoutEntryKey({ type: "divider", id: "open" })
  );
});

test("entries can be placed after the final row", () => {
  const layout = createDefaultLifecycleLayout();
  const first = layout.entries[0];
  const last = layout.entries.at(-1);
  assert.ok(first);
  assert.ok(last);

  const moved = placeLifecycleLayoutEntry(
    layout,
    lifecycleLayoutEntryKey(first),
    lifecycleLayoutEntryKey(last),
    "after"
  );
  assert.equal(lifecycleLayoutEntryKey(moved.entries.at(-1)!), lifecycleLayoutEntryKey(first));
});
