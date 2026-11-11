import { OCTICONS } from "./octicons";
import { createIcon } from "./ui-primitives";
import { VIEW_ICONS, type SavedView, type ViewLayout } from "./saved-views";
import type { ViewScopeSnapshot } from "./views-storage";
import {
  createEditorState,
  editorCanSubmit,
  editorIncompleteViews,
  editorViewErrors,
  editorViewIssue,
  editorStarterTemplates,
  editorStarterCopy,
  editorEquivalentView,
  editorDirty,
  editorSaveSnapshot,
  transitionEditor,
  type EditorEvent,
  type EditorExit
} from "./views-editor-state";

interface EditorConfig {
  onSave(snapshot: ViewScopeSnapshot): Promise<ViewScopeSnapshot>;
  onExit(close: boolean, saved?: ViewScopeSnapshot): void;
  onModeChange(mode: "form" | "customize" | "starters"): void;
}
function node<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  text?: string
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
export function createViewsEditor(
  doc: Document,
  snapshot: ViewScopeSnapshot,
  config: EditorConfig
) {
  const element = node(doc, "section", "gprf-views-editor");
  let state = createEditorState(snapshot);
  let disposed = false;
  let iconOpen = false;
  let descriptionOpen = false;
  let descriptionViewId: string | null = null;
  let requestId = 0;
  let listScroll = 0;
  let returnFocus = ".gprf-add-view";
  let draggedId = "";
  let currentMode: "form" | "customize" | "starters" | undefined;
  const fieldPrefix = `gprf-${crypto.randomUUID()}`;
  const view = doc.defaultView;
  const glyph = (icon: SavedView["icon"]): SVGSVGElement => createIcon(doc, OCTICONS[icon]);
  const button = (
    label: string,
    action: () => void,
    className = "gprf-view-button",
    icon?: SavedView["icon"]
  ): HTMLButtonElement => {
    const result = node(doc, "button", className);
    result.type = "button";
    if (icon) result.append(glyph(icon));
    if (label) result.append(node(doc, "span", "", label));
    result.addEventListener("click", action);
    return result;
  };
  const iconButton = (
    label: string,
    icon: SavedView["icon"],
    action: () => void
  ): HTMLButtonElement => {
    const result = button("", action, "gprf-view-icon-button", icon);
    result.setAttribute("aria-label", label);
    result.title = label;
    return result;
  };
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (!disposed && (editorDirty(state) || state.save.kind === "saving")) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  function syncGuard(): void {
    view?.removeEventListener("beforeunload", beforeUnload);
    if (!disposed && (editorDirty(state) || state.save.kind === "saving"))
      view?.addEventListener("beforeunload", beforeUnload);
  }
  function dispatch(event: EditorEvent): boolean {
    if (disposed) return false;
    const next = transitionEditor(state, event);
    if (!next || next === state) return false;
    state = next;
    syncGuard();
    return true;
  }
  function focus(selector: string, scroll = false): void {
    queueMicrotask(() => {
      if (!disposed && element.isConnected) {
        const target = element.querySelector<HTMLElement>(selector);
        if (scroll) target?.scrollIntoView({ block: "nearest" });
        target?.focus({ preventScroll: true });
      }
    });
  }
  function rememberList(): void {
    listScroll = element.querySelector<HTMLElement>(".gprf-editor-body")?.scrollTop ?? listScroll;
  }
  function exit(action: EditorExit, discard = false): boolean {
    if (disposed || state.save.kind === "saving") return false;
    const next = transitionEditor(state, { type: "exit", action, discard });
    if (!next) {
      dispose();
      config.onExit(action === "close");
      return true;
    }
    if (next === state) return false;
    state = next;
    iconOpen = false;
    syncGuard();
    render();
    focus(state.confirmation ? ".gprf-keep-editing" : state.form ? '[name="name"]' : returnFocus);
    return false;
  }
  function newView(query = "", origin: "picker" | "customize" = "customize"): void {
    rememberList();
    returnFocus = ".gprf-add-view";
    if (
      dispatch({
        type: "new",
        origin,
        view: {
          type: "view",
          id: crypto.randomUUID(),
          name: "",
          description: "",
          query,
          icon: "filter",
          visible: true,
          destination: "repository"
        }
      })
    ) {
      render();
      focus('[name="name"]');
    }
  }
  async function save(): Promise<void> {
    if (!editorCanSubmit(state)) return;
    if (editorIncompleteViews(state).length) {
      dispatch({ type: "validate" });
      iconOpen = false;
      render();
      focus('[aria-invalid="true"]', true);
      return;
    }
    if (!editorDirty(state)) {
      exit("cancel");
      return;
    }
    const update = editorSaveSnapshot(state);
    if (!update) return;
    const id = ++requestId;
    if (!dispatch({ type: "save-start", id })) return;
    iconOpen = false;
    render();
    try {
      const acknowledged = await config.onSave(update);
      if (disposed) return;
      dispatch({ type: "save-success", id, snapshot: acknowledged });
      if (state.save.kind !== "idle") return;
      if (state.latest) {
        render();
        return;
      }
      dispose();
      config.onExit(false, acknowledged);
    } catch (cause) {
      if (disposed) return;
      dispatch({
        type: "save-failure",
        id,
        message:
          cause instanceof Error
            ? cause.message
            : "Could not save changes. Your edits are still here."
      });
      render();
      focus(state.form ? '[name="name"]' : ".gprf-save-views");
    }
  }
  function requestSave(): void {
    void save().catch((error: unknown) =>
      console.error("GitHub PR Filter: could not finish saving views.", error)
    );
  }
  function replaceLayout(layout: ViewLayout, target?: string): void {
    rememberList();
    if (dispatch({ type: "layout", layout })) {
      render();
      if (target) focus(target);
    }
  }
  function move(id: string, to: number): void {
    const entries = [...state.layout.entries];
    const from = entries.findIndex((entry) => entry.id === id);
    if (from < 0 || to < 0 || to >= entries.length || from === to) return;
    const [entry] = entries.splice(from, 1);
    if (!entry) return;
    entries.splice(to, 0, entry);
    replaceLayout({ ...state.layout, entries }, `[data-move-id="${CSS.escape(id)}"]`);
  }
  function renderList(): HTMLElement {
    const body = node(doc, "div", "gprf-editor-body");
    const add = button("Add a view", () => newView(), "gprf-add-view", "plus");
    add.append(node(doc, "small", "gprf-view-muted", "Name a GitHub search and keep it here"));
    body.append(
      add,
      button(
        "Add from templates…",
        () => {
          rememberList();
          if (dispatch({ type: "catalog" })) {
            render();
            focus(".gprf-view-back");
          }
        },
        "gprf-view-text-button gprf-starter-link"
      )
    );
    const columns = node(doc, "div", "gprf-view-columns");
    columns.append(node(doc, "span", "", "Show in menu"));
    body.append(columns);
    const list = node(doc, "div", "gprf-editor-views-list");
    list.setAttribute("aria-label", "Views and separators");
    state.layout.entries.forEach((entry, index) => {
      const row = node(
        doc,
        "div",
        `gprf-view-editor-row${entry.type === "view" && !entry.visible ? " is-hidden" : ""}`
      );
      row.dataset.entryId = entry.id;
      const handle = iconButton(
        `Reorder ${entry.type === "view" ? entry.name || "Untitled view" : "separator"}`,
        "grabber",
        () => {}
      );
      handle.dataset.moveId = entry.id;
      handle.draggable = !state.source.readOnly;
      handle.title = "Drag or use arrow keys to reorder";
      handle.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          move(entry.id, index + (event.key === "ArrowUp" ? -1 : 1));
        }
      });
      handle.addEventListener("dragstart", (event) => {
        draggedId = entry.id;
        event.dataTransfer?.setData("text/plain", entry.id);
      });
      handle.addEventListener("dragend", () => {
        draggedId = "";
      });
      row.addEventListener("dragover", (event) => {
        if (draggedId) event.preventDefault();
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (draggedId && !state.source.readOnly && state.save.kind === "idle")
          move(draggedId, index);
        draggedId = "";
      });
      row.append(handle);
      if (entry.type === "divider") {
        const divider = node(doc, "span", "gprf-view-divider", "Separator");
        divider.append(node(doc, "span"));
        row.append(
          divider,
          iconButton("Delete separator", "x", () => deleteEntry(entry.id))
        );
      } else {
        const editRow = button(
          "",
          () => {
            rememberList();
            returnFocus = `[data-edit-id="${CSS.escape(entry.id)}"]`;
            if (dispatch({ type: "select", id: entry.id })) {
              render();
              focus('[name="name"]');
            }
          },
          "gprf-edit-view"
        );
        editRow.dataset.editId = entry.id;
        editRow.setAttribute("aria-label", `Edit ${entry.name || "Untitled view"}`);
        const copy = node(doc, "span", "gprf-view-row-copy");
        copy.append(node(doc, "strong", "", entry.name || "Untitled view"));
        const problem = editorViewIssue(entry);
        const original = state.source.layout.entries.find((item) => item.id === entry.id);
        const changed = JSON.stringify(original) !== JSON.stringify(entry);
        const detail = [problem, !entry.visible ? "Not in menu" : "", changed ? "Not saved" : ""]
          .filter(Boolean)
          .join(" · ");
        if (detail) copy.append(node(doc, "small", problem ? "gprf-view-incomplete" : "", detail));
        editRow.append(glyph(entry.icon), copy);
        const visible = node(doc, "input", "gprf-view-visibility");
        visible.type = "checkbox";
        visible.checked = entry.visible;
        visible.dataset.visibilityId = entry.id;
        visible.setAttribute("aria-label", `Show ${entry.name || "Untitled view"} in menu`);
        visible.addEventListener("change", () => {
          rememberList();
          if (dispatch({ type: "visibility", id: entry.id, visible: visible.checked })) {
            render();
            focus(`[data-visibility-id="${CSS.escape(entry.id)}"]`);
          }
        });
        row.append(editRow, visible);
      }
      list.append(row);
    });
    body.append(list);
    const utilities = node(doc, "div", "gprf-editor-utilities");
    utilities.append(
      button(
        "Add separator",
        () =>
          replaceLayout({
            ...state.layout,
            entries: [...state.layout.entries, { type: "divider", id: crypto.randomUUID() }]
          }),
        "gprf-view-text-button gprf-add-separator",
        "plus"
      )
    );
    body.append(
      utilities,
      node(
        doc,
        "small",
        "gprf-view-muted gprf-reorder-help",
        "Drag to reorder, or focus a handle and use ↑ / ↓."
      )
    );
    return body;
  }
  function deleteEntry(id: string): void {
    rememberList();
    if (dispatch({ type: "delete", id })) {
      iconOpen = false;
      render();
      focus(".gprf-undo-delete");
    }
  }
  function renderCatalog(): HTMLElement {
    const body = node(doc, "div", "gprf-editor-body");
    body.append(
      node(
        doc,
        "p",
        "gprf-view-form-note",
        "Add editable copies of common searches, such as Open and Needs review. Existing views and layout stay unchanged."
      )
    );
    for (const template of editorStarterTemplates()) {
      const copy = editorStarterCopy(state, template.id);
      const existing = editorEquivalentView(state, template.query, copy?.id);
      const row = node(doc, "div", "gprf-view-starter");
      const checkbox = node(doc, "input", "gprf-starter-checkbox");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(copy);
      checkbox.disabled = Boolean(existing);
      checkbox.id = `${fieldPrefix}-${template.id}`;
      checkbox.addEventListener("change", () => {
        const scroll = body.scrollTop;
        if (dispatch({ type: "starter", templateId: template.id, id: crypto.randomUUID() })) {
          render();
          const nextBody = element.querySelector<HTMLElement>(".gprf-editor-body");
          if (nextBody) nextBody.scrollTop = scroll;
          focus(`#${CSS.escape(checkbox.id)}`);
        }
      });
      const label = node(doc, "label", "", template.name);
      label.htmlFor = checkbox.id;
      row.append(checkbox, label, node(doc, "code", "", template.query));
      if (existing) {
        const original = state.source.layout.entries.find((item) => item.id === existing.id);
        const unchanged = JSON.stringify(original) === JSON.stringify(existing);
        row.append(
          node(
            doc,
            "small",
            "",
            `${unchanged ? (existing.visible ? "Already in menu" : "Saved · not in menu") : "In this editor · not saved yet"} — ${existing.name}`
          )
        );
        row.append(
          button(
            existing.visible ? "Edit existing" : "Show existing",
            () => {
              const scroll = body.scrollTop;
              if (
                dispatch(
                  existing.visible
                    ? { type: "select", id: existing.id }
                    : { type: "visibility", id: existing.id, visible: true }
                )
              ) {
                render();
                if (state.form) focus('[name="name"]');
                else {
                  const nextBody = element.querySelector<HTMLElement>(".gprf-editor-body");
                  if (nextBody) nextBody.scrollTop = scroll;
                  focus(`#${CSS.escape(checkbox.id)} ~ button`);
                }
              }
            },
            "gprf-view-text-button"
          )
        );
      } else if (copy) row.append(node(doc, "small", "", "Added to this editor · Not saved yet"));
      body.append(row);
    }
    return body;
  }
  function updateForm(): void {
    const saveButton = element.querySelector<HTMLButtonElement>(".gprf-save-views");
    if (saveButton) saveButton.disabled = !editorCanSubmit(state);
    const current = state.form?.draft;
    if (current) {
      const errors = editorViewErrors(current);
      for (const key of ["name", "query", "description"] as const) {
        const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          `[name="${key}"]`
        );
        const error = element.querySelector<HTMLElement>(`[data-field-error="${key}"]`);
        const message = state.validated ? errors[key] : "";
        input?.setAttribute("aria-invalid", String(Boolean(message)));
        if (error) {
          error.textContent = message;
          error.hidden = !message;
        }
      }
      const duplicate = editorEquivalentView(state, current.query, current.id);
      const hint = element.querySelector<HTMLElement>(".gprf-view-duplicate");
      if (hint) {
        hint.textContent =
          duplicate && current.query.trim()
            ? `Also used by: ${duplicate.name}. You can keep separate views.`
            : "";
        hint.hidden = !hint.textContent;
      }
      const invalid = element.querySelector<HTMLElement>(".gprf-view-validation");
      if (invalid) {
        invalid.textContent = `Finish “${current.name.trim() || "Untitled view"}” before saving. Your other changes are still here.`;
        invalid.hidden = !editorViewIssue(current);
      }
    }
    const status = element.querySelector(".gprf-view-editor-footer small");
    if (status) status.textContent = footerStatus();
  }
  function edit(changes: Extract<EditorEvent, { type: "edit" }>["changes"]): void {
    if (dispatch({ type: "edit", changes })) updateForm();
  }
  function renderForm(): HTMLElement {
    if (!state.form) throw new Error("View editor form is closed");
    const current = state.form.draft;
    if (descriptionViewId !== current.id) {
      descriptionViewId = current.id;
      descriptionOpen = false;
    }
    const form = node(doc, "form", "gprf-view-form");
    form.noValidate = true;
    if (!current.visible) {
      const status = node(doc, "div", "gprf-view-visibility-status");
      status.append(
        node(doc, "span", "", "Not shown in menu"),
        button(
          "Manage visibility",
          () => {
            exit("back");
            focus(`[data-visibility-id="${CSS.escape(current.id)}"]`, true);
          },
          "gprf-view-text-button"
        )
      );
      form.append(status);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      requestSave();
    });
    const identity = node(doc, "div", "gprf-view-identity");
    const iconField = node(doc, "div", "gprf-view-field");
    iconField.append(node(doc, "span", "gprf-view-label", "Icon"));
    const iconTrigger = iconButton("Choose view icon", current.icon, () => {
      iconOpen = !iconOpen;
      render();
      focus(iconOpen ? `[data-icon="${current.icon}"]` : ".gprf-view-icon-trigger");
    });
    iconTrigger.classList.add("gprf-view-icon-trigger");
    iconTrigger.setAttribute("aria-expanded", String(iconOpen));
    iconField.append(iconTrigger);
    const nameField = node(doc, "label", "gprf-view-field");
    nameField.append(node(doc, "span", "gprf-view-label", "View name"));
    const name = node(doc, "input", "gprf-view-input");
    name.name = "name";
    name.required = true;
    name.maxLength = 100;
    name.value = current.name;
    name.placeholder = "e.g. Ready for me";
    name.addEventListener("input", () => edit({ name: name.value }));
    nameField.append(name, fieldError(name, "name", "View name"));
    identity.append(iconField, nameField);
    form.append(identity);
    if (iconOpen) {
      const choices = node(doc, "div", "gprf-view-icon-grid");
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-label", "GitHub Octicons");
      VIEW_ICONS.forEach((choice, index) => {
        const tile = iconButton(`${choice.label} icon`, choice.name, () => {
          edit({ icon: choice.name });
          iconOpen = false;
          render();
          focus(".gprf-view-icon-trigger");
        });
        tile.dataset.icon = choice.name;
        tile.setAttribute("aria-pressed", String(choice.name === current.icon));
        tile.addEventListener("keydown", (event) => {
          const offset = (
            { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 } as Record<string, number>
          )[event.key];
          if (offset !== undefined) {
            event.preventDefault();
            const target = VIEW_ICONS[(index + offset + VIEW_ICONS.length) % VIEW_ICONS.length];
            if (target) focus(`[data-icon="${target.name}"]`);
          }
        });
        choices.append(tile);
      });
      form.append(choices);
    }
    const queryField = node(doc, "label", "gprf-view-field");
    queryField.append(node(doc, "span", "gprf-view-label", "GitHub query"));
    const query = node(doc, "textarea", "gprf-view-input gprf-view-query");
    query.name = "query";
    query.value = current.query;
    query.required = true;
    query.maxLength = 8000;
    query.spellcheck = false;
    query.placeholder = "is:pr state:open review-requested:@me";
    query.addEventListener("input", () => edit({ query: query.value }));
    queryField.append(
      query,
      fieldError(query, "query", "GitHub query"),
      node(
        doc,
        "small",
        "gprf-view-muted",
        "GitHub interprets this query. Saving a view does not run it."
      )
    );
    form.append(queryField);
    const description = node(doc, "details", "gprf-view-description");
    description.open = Boolean(
      descriptionOpen || (state.validated && editorViewErrors(current).description)
    );
    description.addEventListener("toggle", () => {
      if (description.isConnected) descriptionOpen = description.open;
    });
    description.append(node(doc, "summary", "", "Description (optional)"));
    const descriptionField = node(doc, "label", "gprf-view-field");
    descriptionField.append(node(doc, "span", "gprf-view-label", "Description"));
    const input = node(doc, "input", "gprf-view-input");
    input.name = "description";
    input.value = current.description;
    input.maxLength = 250;
    input.addEventListener("input", () => edit({ description: input.value }));
    descriptionField.append(input, fieldError(input, "description", "Description"));
    description.append(descriptionField);
    form.append(description);
    form.append(
      node(
        doc,
        "p",
        "gprf-view-form-note",
        "Back keeps this draft in the editor. Save changes saves the whole session."
      )
    );
    form.append(
      button("Delete view", () => deleteEntry(current.id), "gprf-view-text-button gprf-remove-view")
    );
    form.append(node(doc, "p", "gprf-view-form-note gprf-view-duplicate"));
    return form;
  }
  function renderConfirmation(): HTMLElement {
    const action = state.confirmation;
    const notice = node(doc, "div", "gprf-view-confirm");
    notice.setAttribute("role", "alert");
    const title =
      action === "reload" ? "Reload saved views?" : "Discard all changes in this editor?";
    const text = "This includes edits, new views, visibility, order, and deletions.";
    notice.append(node(doc, "strong", "", title), node(doc, "p", "gprf-view-muted", text));
    const actions = node(doc, "div", "gprf-view-actions");
    actions.append(
      button(
        "Keep editing",
        () => {
          dispatch({ type: "keep" });
          render();
          focus(
            state.form ? '[name="name"]' : state.catalog ? ".gprf-view-back" : ".gprf-add-view"
          );
        },
        "gprf-view-button gprf-keep-editing"
      ),
      button(
        action === "reload" ? "Reload views" : "Discard changes",
        () => {
          if (state.confirmation) exit(state.confirmation, true);
        },
        "gprf-view-button gprf-view-danger"
      )
    );
    notice.append(actions);
    return notice;
  }
  function fieldError(
    input: HTMLInputElement | HTMLTextAreaElement,
    key: "name" | "query" | "description",
    label: string
  ): HTMLElement {
    const error = node(doc, "small", "gprf-view-field-error");
    error.dataset.fieldError = key;
    error.id = `${fieldPrefix}-${key}-error`;
    error.hidden = true;
    input.setAttribute("aria-label", label);
    input.setAttribute("aria-describedby", error.id);
    return error;
  }
  function footerStatus(): string {
    if (state.save.kind === "saving") return "Saving changes…";
    const incomplete = editorIncompleteViews(state).length;
    return incomplete
      ? `${incomplete} unfinished view${incomplete === 1 ? "" : "s"} · Not saved yet`
      : editorDirty(state)
        ? "Changes in this editor are not saved yet"
        : "No unsaved changes";
  }
  function render(): void {
    if (disposed) return;
    const form = state.form;
    const mode = form ? "form" : state.catalog ? "starters" : "customize";
    element.dataset.transition = currentMode !== mode ? "enter" : "none";
    if (currentMode !== mode) {
      currentMode = mode;
      config.onModeChange(mode);
    }
    element.replaceChildren();
    element.dataset.mode = mode;
    const header = node(doc, "header", "gprf-view-editor-header");
    if (form || state.catalog)
      header.append(button("← Back to views", () => exit("back"), "gprf-view-back"));
    const heading = node(doc, "div", "gprf-view-heading");
    heading.append(
      node(
        doc,
        "h2",
        "",
        form
          ? form.baseline
            ? "Edit view"
            : "New view"
          : state.catalog
            ? "Add views from templates"
            : "Customize views"
      ),
      iconButton("Close view editor", "x", () => exit("close"))
    );
    header.append(heading, node(doc, "p", "gprf-view-muted", state.source.scope));
    element.append(header);
    if (state.source.readOnly)
      element.append(
        node(
          doc,
          "p",
          "gprf-view-error",
          "This layout is unreadable or uses a newer format. Its saved data has been preserved."
        )
      );
    if (state.latest && state.save.kind !== "saving") {
      const warning = node(doc, "div", "gprf-view-conflict");
      warning.setAttribute("role", "alert");
      warning.append(
        node(
          doc,
          "p",
          "",
          "Views changed elsewhere. Your edits are still here. Reload to use the latest saved views."
        ),
        button("Reload saved views…", () => exit("reload"), "gprf-view-text-button")
      );
      element.append(warning);
    }
    if (state.error) {
      const error = node(doc, "p", "gprf-view-error", state.error);
      error.setAttribute("role", "alert");
      element.append(error);
    }
    if (form && state.validated) {
      const validation = node(doc, "p", "gprf-view-error gprf-view-validation");
      validation.setAttribute("role", "alert");
      element.append(validation);
    }
    const body = form ? renderForm() : state.catalog ? renderCatalog() : renderList();
    // Keep confirmation choices usable, while the editor behind them cannot change.
    if (state.source.readOnly || state.save.kind === "saving" || state.confirmation) {
      for (const input of body.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement
      >("input,textarea,button"))
        input.disabled = true;
      for (const details of body.querySelectorAll("details")) details.inert = true;
    }
    element.append(body);
    const deleted = state.deleted.at(-1);
    if (deleted) {
      const notice = node(doc, "div", "gprf-view-deletion");
      notice.setAttribute("role", "status");
      const undo = button(
        "Undo",
        () => {
          if (dispatch({ type: "undo" })) {
            render();
            focus(
              state.form
                ? '[name="name"]'
                : state.catalog
                  ? ".gprf-view-back"
                  : `[data-${deleted.entry.type === "view" ? "edit" : "move"}-id="${CSS.escape(deleted.entry.id)}"]`,
              true
            );
          }
        },
        "gprf-view-text-button gprf-undo-delete"
      );
      undo.disabled = state.save.kind === "saving" || Boolean(state.confirmation);
      notice.append(
        node(
          doc,
          "span",
          "",
          `Deleted ${deleted.entry.type === "view" ? `“${deleted.entry.name || "Untitled view"}”` : "separator"} · Not saved`
        ),
        undo
      );
      element.append(notice);
    }
    if (state.confirmation) element.append(renderConfirmation());
    const footer = node(doc, "footer", "gprf-view-editor-footer");
    const status = node(doc, "small", "gprf-view-muted", footerStatus());
    status.setAttribute("role", "status");
    const actions = node(doc, "div", "gprf-view-actions");
    const cancel = button("Cancel changes", () => exit("cancel"));
    cancel.disabled = state.save.kind === "saving" || Boolean(state.confirmation);
    const submit = button(
      "Save changes",
      requestSave,
      "gprf-view-button gprf-view-primary gprf-save-views"
    );
    submit.disabled = !editorCanSubmit(state);
    actions.append(cancel, submit);
    footer.append(status, actions);
    element.append(footer);
    if (state.save.kind === "saving")
      for (const control of header.querySelectorAll("button")) control.disabled = true;
    const list = element.querySelector<HTMLElement>(".gprf-editor-body");
    if (list && !state.catalog) list.scrollTop = listScroll;
    updateForm();
    syncGuard();
  }
  function escape(): void {
    if (state.save.kind === "saving") return;
    if (iconOpen) {
      iconOpen = false;
      render();
      focus(".gprf-view-icon-trigger");
    } else if (state.confirmation) {
      dispatch({ type: "keep" });
      render();
      focus(state.form ? '[name="name"]' : state.catalog ? ".gprf-view-back" : ".gprf-add-view");
    } else exit("close");
  }
  function dispose(): void {
    disposed = true;
    view?.removeEventListener("beforeunload", beforeUnload);
  }
  // Constructor stays side-effect free until its element is attached by the menu.
  return {
    element,
    show(query?: string): void {
      if (query !== undefined) {
        newView(query, "picker");
        if (!element.childElementCount) render();
      } else {
        render();
        focus(".gprf-add-view");
      }
    },
    refresh(next: ViewScopeSnapshot): void {
      const previous = state;
      const root = element.getRootNode() as Document | ShadowRoot;
      const active = root.activeElement;
      const field =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
      const name = field && element.contains(field) ? field.name : null;
      const selection = name
        ? {
            start: field?.selectionStart ?? 0,
            end: field?.selectionEnd ?? 0,
            scroll: field?.scrollTop ?? 0
          }
        : null;
      const bodyScroll = element.querySelector<HTMLElement>(".gprf-view-form")?.scrollTop;
      if (
        dispatch({ type: "external", snapshot: next }) &&
        state !== previous &&
        state.save.kind !== "saving"
      ) {
        render();
        if (bodyScroll !== undefined) {
          const body = element.querySelector<HTMLElement>(".gprf-view-form");
          if (body) body.scrollTop = bodyScroll;
        }
        if (name && selection) {
          const replacement = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            `[name="${CSS.escape(name)}"]`
          );
          replacement?.focus({ preventScroll: true });
          replacement?.setSelectionRange(selection.start, selection.end);
          if (replacement) replacement.scrollTop = selection.scroll;
        }
      }
    },
    requestClose(): boolean {
      return exit("close");
    },
    escape,
    destroy: dispose
  };
}
