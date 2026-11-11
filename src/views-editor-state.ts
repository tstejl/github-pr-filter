import {
  createDefaultViewLayout,
  normalizeViewRepository,
  viewQueryKey,
  type SavedView,
  type ViewEntry,
  type ViewLayout
} from "./saved-views";
import type { ViewScopeSnapshot } from "./views-storage";

export type EditorExit = "back" | "cancel" | "close" | "reload";
export interface EditorState {
  source: ViewScopeSnapshot;
  layout: ViewLayout;
  form: { draft: SavedView; baseline: SavedView | null; origin: "picker" | "customize" } | null;
  catalog: boolean;
  newIds: string[];
  deleted: { entry: ViewEntry; index: number }[];
  starterCopies: { templateId: string; initial: SavedView }[];
  validated: boolean;
  confirmation: Exclude<EditorExit, "back"> | null;
  save: { kind: "idle" } | { kind: "saving"; id: number };
  error: string | null;
  latest: ViewScopeSnapshot | null;
}
export type EditorEvent =
  | { type: "layout"; layout: ViewLayout }
  | { type: "select"; id: string }
  | { type: "new"; view: SavedView; origin: "picker" | "customize" }
  | { type: "edit"; changes: Partial<Pick<SavedView, "name" | "description" | "query" | "icon">> }
  | { type: "visibility"; id: string; visible: boolean }
  | { type: "delete"; id: string }
  | { type: "undo" }
  | { type: "catalog" }
  | { type: "starter"; templateId: string; id: string }
  | { type: "validate" }
  | { type: "exit"; action: EditorExit; discard: boolean }
  | { type: "keep" }
  | { type: "external"; snapshot: ViewScopeSnapshot }
  | { type: "save-start"; id: number }
  | { type: "save-success"; id: number; snapshot: ViewScopeSnapshot }
  | { type: "save-failure"; id: number; message: string };

function cloneLayout(layout: ViewLayout): ViewLayout {
  return { ...layout, entries: layout.entries.map((entry) => ({ ...entry })) };
}
function cloneSnapshot(snapshot: ViewScopeSnapshot): ViewScopeSnapshot {
  return { ...snapshot, layout: cloneLayout(snapshot.layout) };
}
function sameEntry(left: object, right: object): boolean {
  const a = Object.entries(left).toSorted(([x], [y]) => x.localeCompare(y));
  const b = Object.entries(right).toSorted(([x], [y]) => x.localeCompare(y));
  return (
    a.length === b.length &&
    a.every(([key, value], index) => b[index]?.[0] === key && b[index]?.[1] === value)
  );
}
function sameLayout(left: ViewLayout, right: ViewLayout): boolean {
  return (
    left.version === right.version &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries[index];
      return other !== undefined && sameEntry(entry, other);
    })
  );
}
function blank(view: SavedView): boolean {
  return ![view.name, view.description, view.query].some((text) => text.trim());
}
function meaningfulLayout(state: EditorState): ViewLayout {
  return {
    ...state.layout,
    entries: state.layout.entries.filter(
      (entry) => !(entry.type === "view" && state.newIds.includes(entry.id) && blank(entry))
    )
  };
}
export function createEditorState(snapshot: ViewScopeSnapshot): EditorState {
  return {
    source: cloneSnapshot(snapshot),
    layout: cloneLayout(snapshot.layout),
    form: null,
    catalog: false,
    newIds: [],
    deleted: [],
    starterCopies: [],
    validated: false,
    confirmation: null,
    save: { kind: "idle" },
    error: null,
    latest: null
  };
}
export function editorFormDirty(state: EditorState): boolean {
  const form = state.form;
  return Boolean(
    form && (form.baseline ? !sameEntry(form.draft, form.baseline) : !blank(form.draft))
  );
}
export function editorDirty(state: EditorState): boolean {
  return !sameLayout(meaningfulLayout(state), state.source.layout);
}
export function editorViewErrors(
  view: SavedView
): Record<"name" | "query" | "description", string> {
  return {
    name: !view.name.trim()
      ? "Enter a name."
      : view.name.length > 100
        ? "Use 100 characters or fewer."
        : "",
    query: !view.query.trim()
      ? "Enter a query."
      : view.query.length > 8000
        ? "Use 8,000 characters or fewer."
        : "",
    description: view.description.length > 250 ? "Use 250 characters or fewer." : ""
  };
}
export function editorViewIssue(view: SavedView): string {
  const errors = editorViewErrors(view);
  return errors.name
    ? view.name.trim()
      ? "Name is too long"
      : "Needs a name"
    : errors.query
      ? view.query.trim()
        ? "Query is too long"
        : "Needs a query"
      : errors.description
        ? "Description is too long"
        : "";
}
export function editorIncompleteViews(state: EditorState): SavedView[] {
  return meaningfulLayout(state).entries.filter(
    (entry): entry is SavedView => entry.type === "view" && Boolean(editorViewIssue(entry))
  );
}
export function editorCanSubmit(state: EditorState): boolean {
  return (
    state.save.kind === "idle" &&
    !state.source.readOnly &&
    normalizeViewRepository(state.source.scope) === state.source.scope &&
    !state.latest &&
    !state.confirmation
  );
}
export function editorCanSave(state: EditorState): boolean {
  return editorCanSubmit(state) && !editorIncompleteViews(state).length;
}
export function editorSaveSnapshot(state: EditorState): ViewScopeSnapshot | null {
  if (!editorCanSave(state)) return null;
  const update = cloneSnapshot(state.source);
  update.layout = cloneLayout(meaningfulLayout(state));
  update.layout.entries = update.layout.entries.map((entry) => {
    const original = state.source.layout.entries.find((item) => item.id === entry.id);
    return entry.type === "view" && (!original || !sameEntry(entry, original))
      ? { ...entry, name: entry.name.trim(), destination: "repository" }
      : entry;
  });
  return update;
}
export function editorStarterTemplates(): SavedView[] {
  return createDefaultViewLayout().entries.flatMap((entry) => {
    if (entry.type !== "view") return [];
    const copy = { ...entry };
    delete copy.builtin;
    return [copy];
  });
}
/** Only unchanged copies can be unchecked in the catalog. Edited copies are ordinary views. */
export function editorStarterCopy(state: EditorState, templateId: string): SavedView | null {
  const initial = state.starterCopies.find((copy) => copy.templateId === templateId)?.initial;
  const current = initial && state.layout.entries.find((entry) => entry.id === initial.id);
  return initial && current && sameEntry(initial, current) ? initial : null;
}
export function editorEquivalentView(
  state: EditorState,
  query: string,
  excludeId?: string
): SavedView | null {
  return (
    state.layout.entries.find(
      (entry): entry is SavedView =>
        entry.type === "view" &&
        entry.id !== excludeId &&
        Boolean(entry.query.trim()) &&
        viewQueryKey(entry.query) === viewQueryKey(query)
    ) ?? null
  );
}
function selectForm(state: EditorState, view: SavedView): EditorState {
  return {
    ...state,
    form: {
      draft: { ...view },
      baseline: state.newIds.includes(view.id) ? null : { ...view },
      origin: "customize"
    },
    catalog: false,
    error: null
  };
}
export function transitionEditor(state: EditorState, event: EditorEvent): EditorState | null {
  if (event.type === "external") {
    if (
      event.snapshot.scope !== state.source.scope ||
      event.snapshot.revision === state.source.revision
    )
      return state;
    if (state.save.kind === "saving") {
      const pending = editorSaveSnapshot({ ...state, save: { kind: "idle" }, latest: null });
      if (pending && sameLayout(pending.layout, event.snapshot.layout)) return state;
    }
    if (state.latest?.revision === event.snapshot.revision) return state;
    return { ...state, latest: cloneSnapshot(event.snapshot) };
  }
  if (event.type === "save-success" || event.type === "save-failure") {
    if (state.save.kind !== "saving" || state.save.id !== event.id) return state;
    if (event.type === "save-failure")
      return { ...state, save: { kind: "idle" }, error: event.message };
    if (event.snapshot.scope !== state.source.scope) return state;
    const latest =
      state.latest &&
      (state.latest.revision === event.snapshot.revision ||
        sameLayout(state.latest.layout, event.snapshot.layout))
        ? null
        : state.latest;
    return { ...createEditorState(event.snapshot), latest };
  }
  if (state.save.kind === "saving") return state;
  if (event.type === "save-start")
    return editorSaveSnapshot(state)
      ? { ...state, save: { kind: "saving", id: event.id }, error: null }
      : state;
  if (event.type === "keep") return state.confirmation ? { ...state, confirmation: null } : state;
  if (state.confirmation && event.type !== "exit") return state;
  if (event.type === "exit") {
    if (state.confirmation && event.action !== state.confirmation) return state;
    if (event.action === "back")
      return state.form || state.catalog
        ? {
            ...state,
            layout: cloneLayout(meaningfulLayout(state)),
            form: null,
            catalog: false,
            confirmation: null
          }
        : state;
    if (event.action === "reload" && !state.latest) return state;
    if (editorDirty(state) && !event.discard) return { ...state, confirmation: event.action };
    return event.action === "reload" ? createEditorState(state.latest!) : null;
  }
  if (event.type === "select") {
    if (state.form) return state;
    const view = state.layout.entries.find(
      (entry): entry is SavedView => entry.type === "view" && entry.id === event.id
    );
    return view ? selectForm(state, view) : state;
  }
  const writable =
    !state.source.readOnly && normalizeViewRepository(state.source.scope) === state.source.scope;
  if (!writable) return state;
  if (event.type === "validate") {
    if (!editorCanSubmit(state)) return state;
    const invalid = editorIncompleteViews(state)[0];
    return { ...(invalid ? selectForm(state, invalid) : state), validated: true };
  }
  if (event.type === "catalog") return state.form ? state : { ...state, catalog: true };
  if (event.type === "layout")
    return state.form || state.catalog
      ? state
      : { ...state, layout: cloneLayout(event.layout), error: null };
  if (event.type === "new") {
    if (state.form || state.layout.entries.some((entry) => entry.id === event.view.id))
      return state;
    const view = { ...event.view, visible: true };
    return {
      ...state,
      layout: { ...state.layout, entries: [view, ...state.layout.entries] },
      newIds: [...state.newIds, view.id],
      form: { draft: { ...view }, baseline: null, origin: event.origin },
      catalog: false,
      error: null
    };
  }
  if (event.type === "edit") {
    if (!state.form) return state;
    const draft = { ...state.form.draft, ...event.changes };
    return {
      ...state,
      form: { ...state.form, draft },
      layout: {
        ...state.layout,
        entries: state.layout.entries.map((entry) => (entry.id === draft.id ? { ...draft } : entry))
      },
      error: null
    };
  }
  if (event.type === "visibility") {
    if (state.form) return state;
    return {
      ...state,
      layout: {
        ...state.layout,
        entries: state.layout.entries.map((entry) =>
          entry.type === "view" && entry.id === event.id
            ? { ...entry, visible: event.visible }
            : entry
        )
      },
      error: null
    };
  }
  if (event.type === "delete") {
    const index = state.layout.entries.findIndex((entry) => entry.id === event.id);
    const entry = state.layout.entries[index];
    if (!entry) return state;
    return {
      ...state,
      layout: {
        ...state.layout,
        entries: state.layout.entries.filter((item) => item.id !== entry.id)
      },
      form: null,
      catalog: false,
      deleted: [...state.deleted, { entry: { ...entry }, index }],
      error: null
    };
  }
  if (event.type === "undo") {
    const deleted = state.deleted.at(-1);
    if (!deleted || state.layout.entries.some((entry) => entry.id === deleted.entry.id))
      return state;
    const layout = cloneLayout(state.layout);
    layout.entries.splice(Math.min(deleted.index, layout.entries.length), 0, { ...deleted.entry });
    return { ...state, layout, deleted: state.deleted.slice(0, -1), error: null };
  }
  const template = editorStarterTemplates().find((view) => view.id === event.templateId);
  if (!state.catalog || !template) return state;
  const copy = editorStarterCopy(state, template.id);
  if (copy)
    return {
      ...state,
      layout: {
        ...state.layout,
        entries: state.layout.entries.filter((entry) => entry.id !== copy.id)
      },
      starterCopies: state.starterCopies.filter((item) => item.templateId !== template.id)
    };
  if (
    editorEquivalentView(state, template.query) ||
    state.layout.entries.some((entry) => entry.id === event.id)
  )
    return state;
  let name = template.name;
  let suffix = 2;
  while (state.layout.entries.some((entry) => entry.type === "view" && entry.name === name))
    name = `${template.name} (${suffix++})`;
  const added: SavedView = { ...template, id: event.id, name };
  return {
    ...state,
    layout: { ...state.layout, entries: [...state.layout.entries, added] },
    newIds: [...state.newIds, added.id],
    starterCopies: [
      ...state.starterCopies.filter((item) => item.templateId !== template.id),
      { templateId: template.id, initial: { ...added } }
    ]
  };
}
