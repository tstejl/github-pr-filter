import { describe, expect, test } from "bun:test";
import { createDefaultViewLayout, type SavedView, type ViewLayout } from "../src/saved-views";
import type { ViewScopeSnapshot } from "../src/views-storage";
import {
  createEditorState,
  editorCanSave,
  editorCanSubmit,
  editorIncompleteViews,
  editorStarterCopy,
  editorStarterTemplates,
  editorEquivalentView,
  editorViewErrors,
  editorDirty,
  editorFormDirty,
  editorSaveSnapshot,
  transitionEditor,
  type EditorEvent,
  type EditorState
} from "../src/views-editor-state";

const view: SavedView = {
  type: "view",
  id: "custom",
  name: "Mine",
  description: "",
  query: "is:pr",
  icon: "filter",
  visible: true,
  destination: "repository"
};
const snapshot = (
  layout: ViewLayout = { version: 1, entries: [{ ...view }] },
  revision = "old"
): ViewScopeSnapshot => ({ scope: "owner/repo", layout, revision, readOnly: false });
function step(state: EditorState, event: EditorEvent): EditorState {
  const next = transitionEditor(state, event);
  if (!next) throw new Error(`Unexpected exit: ${event.type}`);
  return next;
}
const select = (): EditorState =>
  step(createEditorState(snapshot()), { type: "select", id: view.id });
const blank: SavedView = { ...view, id: "new", name: "", query: "", description: "" };

describe("editor draft", () => {
  test("clones source, layout, selection, and submitted snapshots", () => {
    const original = snapshot();
    let state = createEditorState(original);
    original.layout.entries[0]!.id = "changed";
    expect(state.source.layout.entries[0]!.id).toBe("custom");
    state = step(state, { type: "select", id: "custom" });
    state = step(state, { type: "edit", changes: { name: " New name " } });
    const update = editorSaveSnapshot(state)!;
    expect(update.layout.entries[0]).toMatchObject({ id: "custom", name: "New name" });
    update.layout.entries[0]!.id = "changed again";
    expect(state.layout.entries[0]!.id).toBe("custom");
    expect(state.form?.draft.name).toBe(" New name ");
  });
  test("new forms count only meaningful text and require complete bounded input", () => {
    let state = step(createEditorState(snapshot()), { type: "new", view: blank, origin: "picker" });
    expect(editorDirty(state)).toBe(false);
    state = step(state, { type: "edit", changes: { name: "  ", description: "\t", icon: "eye" } });
    expect(editorFormDirty(state)).toBe(false);
    expect(editorCanSave(state)).toBe(true);
    expect(editorSaveSnapshot(state)?.layout).toEqual(snapshot().layout);
    for (const field of ["name", "description", "query"] as const) {
      let current = step(state, { type: "edit", changes: { [field]: "a" } });
      expect(editorFormDirty(current)).toBe(true);
      current = step(current, { type: "edit", changes: { [field]: "  " } });
      expect(editorFormDirty(current)).toBe(false);
    }
    state = step(state, { type: "edit", changes: { name: " New ", query: "is:pr" } });
    expect(editorCanSave(state)).toBe(true);
    expect(editorSaveSnapshot(state)?.layout.entries.at(0)).toMatchObject({
      name: "New",
      destination: "repository"
    });
    for (const changes of [
      { name: "n".repeat(101) },
      { query: "q".repeat(8001) },
      { description: "d".repeat(251) }
    ])
      expect(editorCanSave(step(state, { type: "edit", changes }))).toBe(false);
  });
  test("existing edits and layout changes can be undone", () => {
    let state = select();
    state = step(state, { type: "edit", changes: { name: "Other" } });
    expect(editorFormDirty(state)).toBe(true);
    state = step(state, { type: "edit", changes: { name: view.name } });
    expect(editorDirty(state)).toBe(false);
    state = step(state, { type: "exit", action: "back", discard: false });
    state = step(state, { type: "layout", layout: { version: 1, entries: [] } });
    expect(editorDirty(state)).toBe(true);
    state = step(state, { type: "layout", layout: snapshot().layout });
    expect(editorDirty(state)).toBe(false);
  });
  test("read-only and non-repository sources cannot save", () => {
    for (const source of [
      { ...snapshot(), readOnly: true },
      { ...snapshot(), scope: "global" }
    ]) {
      const state = createEditorState(source);
      expect(transitionEditor(state, { type: "layout", layout: { version: 1, entries: [] } })).toBe(
        state
      );
      expect(editorCanSave(state)).toBe(false);
      expect(editorSaveSnapshot(state)).toBeNull();
      expect(transitionEditor(state, { type: "save-start", id: 1 })).toBe(state);
    }
  });
});

describe("editor exits", () => {
  test("Back retains edits and layout changes without confirmation", () => {
    let state = step(createEditorState(snapshot()), {
      type: "layout",
      layout: { version: 1, entries: [view, { type: "divider", id: "sep" }] }
    });
    state = step(state, { type: "select", id: view.id });
    state = step(state, { type: "edit", changes: { name: "Unsaved" } });
    state = step(state, { type: "exit", action: "back", discard: false });
    expect(state.confirmation).toBeNull();
    expect(state.form).toBeNull();
    expect(state.layout.entries).toHaveLength(2);
    expect(editorDirty(state)).toBe(true);
    state = step(state, { type: "select", id: view.id });
    expect(state.form?.draft.name).toBe("Unsaved");
  });
  test("picker Back returns to views; cancel and close guard the whole session", () => {
    const picker = step(createEditorState(snapshot()), {
      type: "new",
      view: blank,
      origin: "picker"
    });
    const back = step(picker, { type: "exit", action: "back", discard: false });
    expect(back.form).toBeNull();
    expect(back.layout).toEqual(snapshot().layout);
    expect(editorDirty(back)).toBe(false);
    const dirty = step(createEditorState(snapshot()), {
      type: "layout",
      layout: { version: 1, entries: [] }
    });
    for (const action of ["cancel", "close"] as const) {
      const prompted = step(dirty, { type: "exit", action, discard: false });
      expect(prompted.confirmation).toBe(action);
      expect(transitionEditor(prompted, { type: "exit", action, discard: true })).toBeNull();
    }
  });
  test("delete stages immediately and Undo restores the edited view at its position", () => {
    let state = step(select(), {
      type: "edit",
      changes: { name: "Latest draft", query: "author:@me" }
    });
    const expected = state.layout;
    state = step(state, { type: "delete", id: view.id });
    expect(state.confirmation).toBeNull();
    expect(state.form).toBeNull();
    expect(state.layout.entries).toEqual([]);
    expect(state.deleted).toHaveLength(1);
    state = step(state, { type: "undo" });
    expect(state.layout).toEqual(expected);
    expect(state.deleted).toEqual([]);
    expect(state.source.layout).toEqual(snapshot().layout);
  });
  test("reload confirms dirty work and accepts the latest snapshot", () => {
    let state = step(select(), { type: "edit", changes: { name: "Unsaved" } });
    const external = snapshot({ version: 1, entries: [{ ...view, name: "Remote" }] }, "new");
    state = step(state, { type: "external", snapshot: external });
    state = step(state, { type: "exit", action: "reload", discard: false });
    expect(state.confirmation).toBe("reload");
    state = step(state, { type: "exit", action: "reload", discard: true });
    expect(state).toEqual(createEditorState(external));
  });
});

describe("save lifecycle", () => {
  test("pending blocks edits and exits, stale responses are ignored, failure preserves work", () => {
    let state = step(select(), { type: "edit", changes: { name: "Unsaved" } });
    state = step(state, { type: "save-start", id: 1 });
    const remote = snapshot(undefined, "remote");
    state = step(state, { type: "external", snapshot: remote });
    for (const event of [
      { type: "edit", changes: { name: "Lost" } },
      { type: "exit", action: "close", discard: true },
      { type: "keep" },
      { type: "save-success", id: 2, snapshot: remote },
      { type: "save-failure", id: 2, message: "late" }
    ] satisfies EditorEvent[])
      expect(transitionEditor(state, event)).toBe(state);
    const failed = step(state, { type: "save-failure", id: 1, message: "Offline" });
    expect(failed.form).toEqual(state.form);
    expect(failed.layout).toEqual(state.layout);
    expect(failed.latest).toEqual(state.latest);
    expect(failed.error).toBe("Offline");
    expect(editorCanSave(failed)).toBe(false);
  });
  test("own storage echo clears on acknowledgement but unrelated changes remain", () => {
    for (const unrelated of [false, true]) {
      let state = step(select(), { type: "edit", changes: { name: "Saved" } });
      const update = editorSaveSnapshot(state)!;
      state = step(state, { type: "save-start", id: 5 });
      const ack = { ...update, revision: "ack" };
      const external = unrelated
        ? snapshot({ version: 1, entries: [{ ...view, name: "Remote" }] }, "remote")
        : { ...ack, revision: "echo" };
      state = step(state, { type: "external", snapshot: external });
      state = step(state, { type: "save-success", id: 5, snapshot: ack });
      expect(state.form).toBeNull();
      expect(state.source).toEqual(ack);
      expect(state.latest).toEqual(unrelated ? external : null);
      expect(state.save.kind).toBe("idle");
    }
  });
  test("own echo does not replace an unrelated update observed during a save", () => {
    let state = step(select(), { type: "edit", changes: { name: "Saved" } });
    const update = editorSaveSnapshot(state)!;
    state = step(state, { type: "save-start", id: 8 });
    const external = snapshot({ version: 1, entries: [{ ...view, name: "Remote" }] }, "remote");
    state = step(state, { type: "external", snapshot: external });
    const echo = { ...update, revision: "echo" };
    expect(transitionEditor(state, { type: "external", snapshot: echo })).toBe(state);
    state = step(state, { type: "save-success", id: 8, snapshot: { ...update, revision: "ack" } });
    expect(state.latest).toEqual(external);
  });
  test("external snapshots ignore other scopes and unchanged revisions", () => {
    const state = select();
    expect(transitionEditor(state, { type: "external", snapshot: snapshot() })).toBe(state);
    expect(
      transitionEditor(state, {
        type: "external",
        snapshot: { ...snapshot(), scope: "global", revision: "new" }
      })
    ).toBe(state);
  });
});

test("100 character existing names can be edited and committed", () => {
  const named = { ...view, name: "n".repeat(100) };
  let state = step(createEditorState(snapshot({ version: 1, entries: [named] })), {
    type: "select",
    id: named.id
  });
  state = step(state, { type: "edit", changes: { description: "Updated" } });
  expect(editorCanSave(state)).toBe(true);
  expect(editorSaveSnapshot(state)?.layout.entries[0]).toMatchObject({
    name: named.name,
    description: "Updated"
  });
});

test("confirmation blocks save until it is dismissed", () => {
  let state = step(select(), { type: "edit", changes: { name: "Changed" } });
  state = step(state, { type: "exit", action: "close", discard: false });
  expect(editorCanSave(state)).toBe(false);
  expect(editorSaveSnapshot(state)).toBeNull();
  expect(transitionEditor(state, { type: "save-start", id: 1 })).toBe(state);
  state = step(state, { type: "keep" });
  expect(editorCanSave(state)).toBe(true);
});

test("protected scopes allow inspection but reject mutations", () => {
  for (const source of [
    { ...snapshot(), readOnly: true },
    { ...snapshot(), scope: "global" }
  ]) {
    let state = createEditorState(source);
    expect(transitionEditor(state, { type: "new", view: blank, origin: "customize" })).toBe(state);
    for (const event of [
      { type: "catalog" },
      { type: "undo" },
      { type: "delete", id: view.id },
      { type: "visibility", id: view.id, visible: false },
      { type: "starter", templateId: "builtin-open", id: "fresh" },
      { type: "validate" }
    ] satisfies EditorEvent[])
      expect(transitionEditor(state, event)).toBe(state);
    state = step(state, { type: "select", id: view.id });
    expect(state.form?.draft).toEqual(view);
    expect(transitionEditor(state, { type: "edit", changes: { name: "Changed" } })).toBe(state);
    expect(transitionEditor(state, { type: "delete", id: view.id })).toBe(state);
  }
});

test("new views save at the top and edited dashboard views become repository views", () => {
  let state = step(createEditorState(snapshot()), {
    type: "new",
    view: { ...view, id: "new", destination: "dashboard" },
    origin: "customize"
  });
  expect(editorSaveSnapshot(state)?.layout.entries.map((entry) => entry.id)).toEqual([
    "new",
    "custom"
  ]);
  expect(editorSaveSnapshot(state)?.layout.entries[0]).toMatchObject({ destination: "repository" });
  const dashboard: SavedView = { ...view, destination: "dashboard" };
  state = step(createEditorState(snapshot({ version: 1, entries: [dashboard] })), {
    type: "select",
    id: view.id
  });
  state = step(state, { type: "edit", changes: { name: "Changed" } });
  expect(editorSaveSnapshot(state)?.layout.entries[0]).toMatchObject({ destination: "repository" });
  state = step(state, { type: "edit", changes: { name: dashboard.name } });
  state = step(state, { type: "exit", action: "back", discard: false });
  state = step(state, {
    type: "layout",
    layout: { version: 1, entries: [dashboard, { type: "divider", id: "divider" }] }
  });
  state = step(state, { type: "select", id: dashboard.id });
  expect(editorSaveSnapshot(state)?.layout.entries[0]).toMatchObject({ destination: "dashboard" });
});

describe("one staged editing session", () => {
  test("multiple partial drafts survive Back and block the whole save", () => {
    let state = step(createEditorState(snapshot()), {
      type: "visibility",
      id: view.id,
      visible: false
    });
    state = step(state, {
      type: "new",
      view: { ...blank, name: "First draft" },
      origin: "customize"
    });
    state = step(state, { type: "exit", action: "back", discard: false });
    state = step(state, {
      type: "new",
      view: { ...blank, id: "second", query: "author:@me" },
      origin: "customize"
    });
    state = step(state, { type: "exit", action: "back", discard: false });
    expect(editorIncompleteViews(state).map((item) => item.id)).toEqual(["second", "new"]);
    expect(editorCanSubmit(state)).toBe(true);
    expect(editorCanSave(state)).toBe(false);
    expect(editorSaveSnapshot(state)).toBeNull();
    expect(transitionEditor(state, { type: "save-start", id: 1 })).toBe(state);
    state = step(state, { type: "validate" });
    expect(state.form?.draft.id).toBe("second");
    expect(state.validated).toBe(true);
    state = step(state, { type: "edit", changes: { name: "Second draft" } });
    state = step(state, { type: "validate" });
    expect(state.form?.draft.id).toBe("new");
    state = step(state, { type: "edit", changes: { query: "is:pr label:triage" } });
    const saved = editorSaveSnapshot(state)!;
    expect(saved.layout.entries).toHaveLength(3);
    expect(saved.layout.entries.find((entry) => entry.id === view.id)).toMatchObject({
      visible: false
    });
    expect(state.source.layout.entries).toEqual([view]);
  });
  test("blank new drafts disappear, but clearing an existing view retains an invalid draft", () => {
    for (const origin of ["picker", "customize"] as const) {
      let state = step(createEditorState(snapshot()), { type: "new", view: blank, origin });
      state = step(state, {
        type: "edit",
        changes: { icon: "eye", name: "  ", query: "\n ", description: "\t" }
      });
      expect(editorDirty(state)).toBe(false);
      expect(transitionEditor(state, { type: "exit", action: "close", discard: false })).toBeNull();
      state = step(state, { type: "exit", action: "back", discard: false });
      expect(state.layout).toEqual(snapshot().layout);
    }
    let state = step(select(), { type: "edit", changes: { name: "", query: "", description: "" } });
    state = step(state, { type: "exit", action: "back", discard: false });
    expect(state.layout.entries).toHaveLength(1);
    expect(editorDirty(state)).toBe(true);
    expect(editorSaveSnapshot(state)).toBeNull();
  });
  test("deletions of built-ins, custom views, and separators share one Undo stack", () => {
    const source = snapshot(createDefaultViewLayout());
    let state = createEditorState(source);
    const ids = source.layout.entries.slice(0, 3).map((entry) => entry.id);
    for (const id of ids) state = step(state, { type: "delete", id });
    expect(state.deleted).toHaveLength(3);
    for (let index = 0; index < ids.length; index++) state = step(state, { type: "undo" });
    expect(state.layout).toEqual(source.layout);
    expect(editorDirty(state)).toBe(false);
    expect(transitionEditor(state, { type: "undo" })).toBe(state);
    expect(transitionEditor(state, { type: "delete", id: "missing" })).toBe(state);
  });
  test("new views are visible by default and duplicate IDs cannot replace existing work", () => {
    const source = createEditorState(snapshot());
    expect(transitionEditor(source, { type: "new", view, origin: "customize" })).toBe(source);
    const added = step(source, {
      type: "new",
      view: { ...blank, visible: false },
      origin: "customize"
    });
    expect(added.form?.draft.visible).toBe(true);
    expect(transitionEditor(added, { type: "visibility", id: blank.id, visible: false })).toBe(
      added
    );
  });
  test("validation enforces storage bounds but delegates search syntax to GitHub", () => {
    let state = step(select(), {
      type: "edit",
      changes: { query: 'is:pr (unknown:??? OR "unfinished' }
    });
    expect(editorCanSave(state)).toBe(true);
    expect(
      editorViewErrors({ ...view, name: " ", query: "\n", description: "d".repeat(251) })
    ).toEqual({
      name: "Enter a name.",
      query: "Enter a query.",
      description: "Use 250 characters or fewer."
    });
    state = step(state, { type: "edit", changes: { name: "n".repeat(101) } });
    state = step(state, { type: "exit", action: "back", discard: false });
    expect(editorCanSave(state)).toBe(false);
  });
  test("failure retains deletions, starter choices, and validation state; acknowledgement clears them", () => {
    let state = step(createEditorState(snapshot()), { type: "catalog" });
    state = step(state, { type: "starter", templateId: "builtin-open", id: "copy" });
    state = step(state, { type: "exit", action: "back", discard: false });
    state = step(state, { type: "delete", id: view.id });
    const update = editorSaveSnapshot(state)!;
    state = step(state, { type: "save-start", id: 12 });
    for (const event of [
      { type: "undo" },
      { type: "delete", id: "copy" },
      { type: "catalog" },
      { type: "visibility", id: "copy", visible: false },
      { type: "validate" }
    ] satisfies EditorEvent[])
      expect(transitionEditor(state, event)).toBe(state);
    const failed = step(state, { type: "save-failure", id: 12, message: "Offline" });
    expect(failed.deleted).toEqual(state.deleted);
    expect(failed.starterCopies).toEqual(state.starterCopies);
    expect(failed.layout).toEqual(state.layout);
    expect(editorCanSave(failed)).toBe(true);
    state = step(failed, { type: "save-start", id: 13 });
    const ack = { ...update, revision: "ack" };
    state = step(state, { type: "save-success", id: 13, snapshot: ack });
    expect(state).toEqual(createEditorState(ack));
  });
});

describe("additive starter views", () => {
  test("templates are independent editable copies with no built-in ancestry", () => {
    const templates = editorStarterTemplates();
    expect(templates).toHaveLength(8);
    expect(templates.every((template) => !Object.hasOwn(template, "builtin"))).toBe(true);
    templates[0]!.name = "Changed";
    expect(editorStarterTemplates()[0]!.name).not.toBe("Changed");
  });
  test("adding and unchecking a starter preserves existing definitions and layout", () => {
    const source = snapshot({
      version: 1,
      entries: [
        {
          ...view,
          id: "builtin-open",
          name: "My team",
          query: "is:pr assignee:@me",
          builtin: "open",
          visible: false
        },
        { type: "divider", id: "sep" }
      ]
    });
    let state = step(createEditorState(source), { type: "catalog" });
    state = step(state, { type: "starter", templateId: "builtin-open", id: "fresh" });
    expect(state.layout.entries.slice(0, 2)).toEqual(source.layout.entries);
    expect(state.layout.entries.at(-1)).toMatchObject({
      id: "fresh",
      name: "Open",
      visible: true,
      query: "is:pr state:open"
    });
    expect(state.layout.entries.at(-1)).not.toHaveProperty("builtin");
    state = step(state, { type: "exit", action: "back", discard: false });
    state = step(state, { type: "catalog" });
    expect(editorStarterCopy(state, "builtin-open")?.id).toBe("fresh");
    state = step(state, { type: "starter", templateId: "builtin-open", id: "ignored" });
    expect(state.layout).toEqual(source.layout);
    expect(editorDirty(state)).toBe(false);
  });
  test("equivalent hidden views require explicit showing instead of a duplicate or silent reactivation", () => {
    const hidden = { ...view, query: "state:open type:pr", visible: false };
    let state = step(createEditorState(snapshot({ version: 1, entries: [hidden] })), {
      type: "catalog"
    });
    expect(editorEquivalentView(state, "is:pr is:open")?.id).toBe(hidden.id);
    expect(
      transitionEditor(state, { type: "starter", templateId: "builtin-open", id: "duplicate" })
    ).toBe(state);
    state = step(state, { type: "visibility", id: hidden.id, visible: true });
    expect(state.layout.entries).toEqual([{ ...hidden, visible: true }]);
    expect(state.source.layout.entries).toEqual([hidden]);
  });
  test("editing a starter copy protects its work from catalog unchecking", () => {
    let state = step(createEditorState(snapshot()), { type: "catalog" });
    state = step(state, { type: "starter", templateId: "builtin-open", id: "copy" });
    state = step(state, { type: "exit", action: "back", discard: false });
    state = step(state, { type: "select", id: "copy" });
    state = step(state, {
      type: "edit",
      changes: { name: "Edited open", description: "Keep this", icon: "eye" }
    });
    state = step(state, { type: "exit", action: "back", discard: false });
    state = step(state, { type: "catalog" });
    expect(editorStarterCopy(state, "builtin-open")).toBeNull();
    expect(
      transitionEditor(state, { type: "starter", templateId: "builtin-open", id: "replacement" })
    ).toBe(state);
    expect(state.layout.entries.at(-1)).toMatchObject({
      id: "copy",
      name: "Edited open",
      description: "Keep this",
      icon: "eye"
    });
  });
  test("names are disambiguated and invalid templates or occupied IDs cannot overwrite views", () => {
    let state = step(
      createEditorState(
        snapshot({
          version: 1,
          entries: [
            { ...view, name: "Open", query: "author:@me" },
            { ...view, id: "two", name: "Open (2)", query: "label:team" }
          ]
        })
      ),
      { type: "catalog" }
    );
    for (const event of [
      { type: "starter", templateId: "missing", id: "fresh" },
      { type: "starter", templateId: "builtin-open", id: view.id }
    ] satisfies EditorEvent[])
      expect(transitionEditor(state, event)).toBe(state);
    state = step(state, { type: "starter", templateId: "builtin-open", id: "fresh" });
    expect(state.layout.entries.at(-1)).toMatchObject({ name: "Open (3)" });
  });
});

test("confirmation requires its own decision before navigating within the session", () => {
  let state = step(select(), { type: "edit", changes: { name: "Keep this" } });
  state = step(state, { type: "exit", action: "close", discard: false });
  expect(transitionEditor(state, { type: "exit", action: "back", discard: false })).toBe(state);
  expect(transitionEditor(state, { type: "catalog" })).toBe(state);
  state = step(state, { type: "keep" });
  expect(step(state, { type: "exit", action: "back", discard: false }).form).toBeNull();
});
