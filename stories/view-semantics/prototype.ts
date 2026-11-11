// Deliberately isolated from the extension editor and storage state machines.
import baseCss from "../../src/content.css?raw";
import menuCss from "../../src/views-menu.css?raw";
import editorCss from "../../src/views-editor.css?raw";
import themeCss from "../storybook.css?raw";
import proposalCss from "./prototype.css?raw";
import { createMenuOverlay } from "../../src/menu-overlay";
import { OCTICONS, type OcticonName } from "../../src/octicons";
import { createIcon } from "../../src/ui-primitives";
import {
  createDefaultViewLayout,
  VIEW_ICONS,
  viewQueryKey,
  visibleViewEntries,
  type SavedView,
  type ViewEntry
} from "../../src/saved-views";

type Screen = "picker" | "manage" | "form" | "starters";
type Args = {
  theme: "light" | "dark";
  screen: Screen | "draft" | "deleted" | "validation" | "hidden";
};
const clone = <T>(value: T): T => structuredClone(value);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, css = "", text = "") {
  const element = document.createElement(tag);
  element.className = css;
  element.textContent = text;
  return element;
}
function button(text: string, css: string, action: () => void) {
  const element = node("button", css, text);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
}
function icon(name: OcticonName) {
  return createIcon(document, OCTICONS[name]);
}
function blank(view: SavedView) {
  return ![view.name, view.query, view.description].some((text) => text.trim());
}
function issue(view: SavedView) {
  if (!view.name.trim()) return "Needs a name";
  if (!view.query.trim()) return "Needs a query";
  if (view.name.length > 100) return "Name is too long";
  if (view.query.length > 8000) return "Query is too long";
  if (view.description.length > 250) return "Description is too long";
  return "";
}

export function createSemanticsPreview(args: Args): HTMLElement {
  const host = node("div");
  const root = host.attachShadow({ mode: "open" });
  const style = node("style");
  style.textContent = [baseCss, menuCss, editorCss, themeCss, proposalCss].join("\n");
  const shell = node("main", "gprf-storybook-shell");
  shell.dataset.theme = args.theme;
  root.append(style, shell);
  const page = node("div", "proposal-page");
  const search = node("input", "proposal-search");
  search.readOnly = true;
  search.setAttribute("aria-label", "Current GitHub search");
  const list = node("section", "proposal-list");
  const toolbar = node("div", "proposal-toolbar");
  const control = node("details", "gprf-lifecycle gprf-lifecycle--preview");
  const summary = node("summary", "gprf-lifecycle-summary");
  control.append(summary);
  toolbar.append(control);
  list.append(toolbar);
  for (const [index, title] of [
    "Fix pagination when filters change",
    "Improve review assignment defaults",
    "Handle empty search results",
    "Update API documentation",
    "Refactor list hydration checks",
    "Support more search qualifiers",
    "Reduce draft notification noise",
    "Add repository health checks"
  ].entries()) {
    const row = node("article", "proposal-pr");
    row.append(
      node("strong", "", title),
      node("p", "", `#${4821 - index} opened ${index + 1} hours ago · review requested`)
    );
    list.append(row);
  }
  const status = node(
    "p",
    "proposal-status",
    "Design proposal · local preview only · no extension storage"
  );
  status.setAttribute("role", "status");
  page.append(
    node("h1", "", "Cartesian-Systems / cartesian-server · Pull requests"),
    search,
    list,
    status
  );
  shell.append(page);
  const menu = node("div", "gprf-saved-menu proposal-menu");
  menu.setAttribute("aria-label", "Repository views");
  shell.append(menu);
  const overlay = createMenuOverlay(control, summary, menu);
  const templates = createDefaultViewLayout().entries.filter(
    (entry): entry is SavedView => entry.type === "view"
  );
  let saved: ViewEntry[] = createDefaultViewLayout()
    .entries.filter((entry) => entry.id !== "builtin-closed")
    .map((entry) => {
      const copy = clone(entry);
      delete copy.builtin;
      if (copy.type === "view" && copy.id === "builtin-open") {
        copy.name = "My team";
        copy.query = "is:pr state:open draft:false assignee:@me";
        copy.description = "Open work assigned to me";
      }
      if (copy.type === "view" && copy.id === "builtin-draft") copy.visible = false;
      return copy;
    });
  saved.unshift({
    type: "view",
    id: "ready-me",
    name: "Ready for me",
    description: "Unapproved PRs from the team",
    query: "is:pr state:open draft:false -review:approved -author:@me sort:updated-desc",
    icon: "codeReview",
    visible: true,
    destination: "repository"
  });
  let working = clone(saved);
  let screen: Screen = "manage";
  let editingId = "builtin-open";
  let activeId = "builtin-open";
  let currentQuery = "is:pr state:open draft:false assignee:@me";
  let serial = 0;
  let validated = false;
  let showIcons = false;
  let discard: "picker" | "closed" | null = null;
  const newIds = new Set<string>();
  const starterCopies = new Map<string, SavedView>();
  const deleted: { entry: ViewEntry; index: number }[] = [];
  let dragId: string | null = null;
  const writes: ViewEntry[][] = [];
  Object.assign(host, { semanticsStory: { writes, snapshot: () => clone(saved) } });

  function meaningfulEntries() {
    return working.filter(
      (entry) => !(entry.type === "view" && newIds.has(entry.id) && blank(entry))
    );
  }
  function dirty() {
    return JSON.stringify(meaningfulEntries()) !== JSON.stringify(saved);
  }
  function updateSummary() {
    const match = saved.find(
      (entry): entry is SavedView =>
        entry.type === "view" &&
        entry.id === activeId &&
        viewQueryKey(entry.query) === viewQueryKey(currentQuery)
    );
    summary.textContent = `17  ${match?.name ?? "Custom filter"}`;
    summary.append(node("span", "gprf-chevron"));
    search.value = currentQuery;
  }
  function begin() {
    working = clone(saved);
    newIds.clear();
    starterCopies.clear();
    deleted.length = 0;
    validated = false;
    discard = null;
    screen = "manage";
    render();
  }
  function cleanBlankDrafts() {
    working = meaningfulEntries();
  }
  function back() {
    cleanBlankDrafts();
    screen = "manage";
    showIcons = false;
    render();
  }
  function requestExit(target: "picker" | "closed") {
    if (dirty()) {
      discard = target;
      render();
      return;
    }
    exit(target);
  }
  function exit(target: "picker" | "closed") {
    working = clone(saved);
    deleted.length = 0;
    newIds.clear();
    starterCopies.clear();
    validated = false;
    discard = null;
    screen = "picker";
    render();
    if (target === "closed") {
      overlay.hide();
      summary.focus();
    }
  }
  function edit(id: string) {
    editingId = id;
    screen = "form";
    showIcons = false;
    render();
  }
  function addView() {
    const id = `new-${++serial}`;
    working.unshift({
      type: "view",
      id,
      name: "",
      description: "",
      query: "",
      icon: "filter",
      visible: true,
      destination: "repository"
    });
    newIds.add(id);
    edit(id);
    menu.querySelector<HTMLInputElement>("#proposal-name")?.focus();
  }
  function deleteEntry(id: string) {
    const index = working.findIndex((entry) => entry.id === id);
    const entry = working[index];
    if (!entry) return;
    deleted.push({ entry: clone(entry), index });
    working.splice(index, 1);
    screen = "manage";
    render();
  }
  function move(id: string, to: number) {
    const from = working.findIndex((entry) => entry.id === id);
    const entry = working[from];
    if (!entry) return;
    working.splice(from, 1);
    working.splice(Math.max(0, Math.min(to, working.length)), 0, entry);
    render();
    menu.querySelector<HTMLButtonElement>(`[data-grip="${id}"]`)?.focus();
  }
  function save() {
    cleanBlankDrafts();
    validated = true;
    const invalid = working.find(
      (entry): entry is SavedView => entry.type === "view" && Boolean(issue(entry))
    );
    if (invalid) {
      edit(invalid.id);
      menu.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    saved = clone(working);
    writes.push(clone(saved));
    deleted.length = 0;
    newIds.clear();
    starterCopies.clear();
    validated = false;
    screen = "picker";
    updateSummary();
    render();
    status.textContent = "Saved in this preview. Your current GitHub search has not changed.";
  }
  function header(title: string, subtitle: string, hasBack = false) {
    const result = node("header", "gprf-view-editor-header");
    if (hasBack) result.append(button("← Back to views", "gprf-view-back", back));
    const heading = node("div", "gprf-view-heading");
    const close = button("", "gprf-view-icon-button", () => requestExit("closed"));
    close.setAttribute("aria-label", "Close editor");
    close.append(icon("x"));
    heading.append(node("h2", "", title), close);
    result.append(heading, node("p", "gprf-view-muted", subtitle));
    return result;
  }
  function footer() {
    const result = node("footer", "gprf-view-editor-footer");
    const actions = node("div", "gprf-view-actions");
    actions.append(
      button("Cancel changes", "gprf-view-button", () => requestExit("picker")),
      button("Save changes", "gprf-view-button gprf-view-primary", save)
    );
    const incomplete = meaningfulEntries().filter(
      (entry) => entry.type === "view" && issue(entry)
    ).length;
    result.append(
      node(
        "small",
        "",
        incomplete
          ? `${incomplete} unfinished view${incomplete === 1 ? "" : "s"} · Not saved yet`
          : dirty()
            ? "Changes in this editor are not saved yet"
            : "No unsaved changes"
      ),
      actions
    );
    return result;
  }
  function manage() {
    const body = node("div", "gprf-editor-body");
    const add = button("", "gprf-add-view", addView);
    add.append(
      icon("plus"),
      node("span", "", "Add a view"),
      node("small", "gprf-view-muted", "Save a name, query, and icon")
    );
    body.append(
      add,
      button("Add from templates…", "gprf-view-text-button proposal-starter-link", () => {
        screen = "starters";
        render();
      })
    );
    const columns = node("div", "proposal-columns");
    columns.append(node("span", "", "Show in menu"));
    body.append(columns);
    working.forEach((entry, index) => {
      const row = node("div", "gprf-view-editor-row");
      row.dataset.entryId = entry.id;
      row.draggable = true;
      row.addEventListener("dragstart", () => {
        dragId = entry.id;
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (dragId) move(dragId, index);
        dragId = null;
      });
      const grip = button("", "gprf-view-icon-button", () => {});
      grip.dataset.grip = entry.id;
      grip.append(icon("grabber"));
      grip.setAttribute(
        "aria-label",
        `Reorder ${entry.type === "view" ? entry.name || "Untitled view" : "separator"}; use arrow keys`
      );
      grip.addEventListener("keydown", (event) => {
        if (["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          move(entry.id, index + (event.key === "ArrowUp" ? -1 : 1));
        }
      });
      row.append(grip);
      if (entry.type === "divider") {
        const line = node("div", "gprf-view-divider", "Separator");
        line.append(node("span"));
        const remove = button("", "gprf-view-icon-button", () => deleteEntry(entry.id));
        remove.append(icon("x"));
        remove.setAttribute("aria-label", "Delete separator");
        row.append(line, remove);
      } else {
        const editButton = button("", "gprf-edit-view", () => edit(entry.id));
        editButton.setAttribute("aria-label", `Edit ${entry.name || "Untitled view"}`);
        const copy = node("span", "proposal-row-copy");
        copy.append(node("strong", "", entry.name || "Untitled view"));
        const problem = issue(entry);
        const original = saved.find((item) => item.id === entry.id);
        const changed = JSON.stringify(original) !== JSON.stringify(entry);
        if (problem || !entry.visible || changed)
          copy.append(
            node(
              "small",
              problem ? "is-incomplete" : "",
              [problem, !entry.visible ? "Not in menu" : "", changed ? "Not saved" : ""]
                .filter(Boolean)
                .join(" · ")
            )
          );
        editButton.append(icon(entry.icon), copy);
        const visible = node("input");
        visible.type = "checkbox";
        visible.checked = entry.visible;
        visible.dataset.visibilityId = entry.id;
        visible.setAttribute("aria-label", `Show ${entry.name || "Untitled view"} in menu`);
        visible.addEventListener("change", () => {
          entry.visible = visible.checked;
          render();
        });
        row.append(editButton, visible);
      }
      body.append(row);
    });
    body.append(
      button("+ Add separator", "gprf-view-text-button", () => {
        working.push({ type: "divider", id: `separator-${++serial}` });
        render();
      }),
      node(
        "small",
        "gprf-reorder-help gprf-view-muted",
        "Drag to reorder, or focus a grip and use ↑ / ↓."
      )
    );
    return body;
  }
  function form() {
    const view = working.find(
      (entry): entry is SavedView => entry.type === "view" && entry.id === editingId
    );
    const body = node("div", "gprf-view-form");
    if (!view) return body;
    if (!view.visible) {
      const visibility = node("div", "proposal-visibility-status");
      visibility.append(
        node("span", "", "Not shown in menu"),
        button("Manage visibility", "gprf-view-text-button", () => {
          back();
          const checkbox = menu.querySelector<HTMLInputElement>(
            `[data-visibility-id="${CSS.escape(view.id)}"]`
          );
          checkbox?.closest(".gprf-view-editor-row")?.scrollIntoView({ block: "nearest" });
          checkbox?.focus({ preventScroll: true });
        })
      );
      body.append(visibility);
    }
    const duplicateNote = node("p", "proposal-hint");
    function updateDuplicates() {
      const duplicates = working.filter(
        (entry): entry is SavedView =>
          entry.type === "view" &&
          entry.id !== view?.id &&
          Boolean(view?.query.trim()) &&
          viewQueryKey(entry.query) === viewQueryKey(view?.query ?? "")
      );
      duplicateNote.textContent = duplicates.length
        ? `Also used by: ${duplicates.map((item) => item.name).join(", ")}. You can keep separate views.`
        : "";
      duplicateNote.hidden = !duplicates.length;
    }
    updateDuplicates();
    const identity = node("div", "gprf-view-identity");
    const iconField = node("div", "gprf-view-field");
    const chooseIcon = button("", "gprf-view-icon-trigger", () => {
      showIcons = !showIcons;
      render();
    });
    chooseIcon.setAttribute("aria-label", "Choose icon");
    chooseIcon.setAttribute("aria-expanded", String(showIcons));
    chooseIcon.append(icon(view.icon));
    iconField.append(node("span", "gprf-view-label", "Icon"), chooseIcon);
    function field(key: "name" | "query" | "description", label: string, limit: number) {
      const container = node("div", "gprf-view-field");
      const input =
        key === "query"
          ? node("textarea", "gprf-view-input gprf-view-query")
          : node("input", "gprf-view-input");
      input.id = `proposal-${key}`;
      input.value = view?.[key] ?? "";
      input.maxLength = limit;
      input.placeholder =
        key === "name"
          ? "e.g. Ready for my review"
          : key === "query"
            ? "is:pr state:open draft:false"
            : "Optional menu description";
      const fieldLabel = node("label", "gprf-view-label", label);
      fieldLabel.htmlFor = input.id;
      container.append(fieldLabel, input);
      const error = node("small", "proposal-field-error");
      error.id = `${input.id}-error`;
      const validate = () => {
        const message =
          validated && key !== "description" && !input.value.trim() ? `Enter a ${key}.` : "";
        input.setAttribute("aria-invalid", String(Boolean(message)));
        input.setAttribute("aria-describedby", error.id);
        error.textContent = message;
        error.hidden = !message;
      };
      input.addEventListener("input", () => {
        if (view) view[key] = input.value;
        validate();
        updateDuplicates();
        const alert = menu.querySelector<HTMLElement>(".gprf-view-error");
        if (alert && view) alert.hidden = !issue(view);
        const note = menu.querySelector("footer small");
        if (note) note.textContent = "Changes in this editor are not saved yet";
      });
      validate();
      container.append(error);
      return container;
    }
    identity.append(iconField, field("name", "Name", 100));
    body.append(identity);
    if (showIcons) {
      const grid = node("div", "gprf-view-icon-grid");
      for (const option of VIEW_ICONS) {
        const choice = button("", "gprf-view-icon-button", () => {
          view.icon = option.name;
          showIcons = false;
          render();
        });
        choice.append(icon(option.name));
        choice.setAttribute("aria-label", option.label);
        choice.setAttribute("aria-pressed", String(view.icon === option.name));
        grid.append(choice);
      }
      body.append(grid);
    }
    body.append(
      field("query", "GitHub query", 8000),
      node("p", "proposal-hint", "GitHub interprets this query. Saving a view does not run it.")
    );
    body.append(duplicateNote);
    const description = node("details", "gprf-view-description");
    description.append(
      node("summary", "", "Description (optional)"),
      field("description", "Menu description", 250)
    );
    body.append(description);
    const note = node(
      "p",
      "gprf-view-form-note",
      "Back keeps this draft in the editor. Save changes saves the whole session."
    );
    body.append(
      note,
      button("Delete view", "gprf-view-text-button gprf-view-danger", () => deleteEntry(view.id))
    );
    return body;
  }
  function starters() {
    const body = node("div", "gprf-editor-body");
    body.append(
      node(
        "p",
        "proposal-hint",
        "Add editable copies of common searches, such as Open and Needs review. Existing views and layout stay unchanged."
      )
    );
    for (const template of templates) {
      const initialCopy = starterCopies.get(template.id);
      const currentCopy = initialCopy && working.find((entry) => entry.id === initialCopy.id);
      // Once a starter copy is edited, treat it as an ordinary existing view.
      // Revisiting the catalog must not offer an uncheck that erases those edits.
      const copyId =
        initialCopy && JSON.stringify(initialCopy) === JSON.stringify(currentCopy)
          ? initialCopy.id
          : undefined;
      if (!copyId) starterCopies.delete(template.id);
      const existing = working.find(
        (entry): entry is SavedView =>
          entry.type === "view" &&
          entry.id !== copyId &&
          viewQueryKey(entry.query) === viewQueryKey(template.query)
      );
      const row = node("div", "proposal-starter");
      const check = node("input");
      check.type = "checkbox";
      check.id = `starter-${template.id}`;
      check.checked = Boolean(copyId);
      check.disabled = Boolean(existing);
      const label = node("label", "", template.name);
      label.htmlFor = check.id;
      check.addEventListener("change", () => {
        if (check.checked) {
          const id = `starter-copy-${++serial}`;
          let name = template.name;
          let suffix = 2;
          while (working.some((entry) => entry.type === "view" && entry.name === name))
            name = `${template.name} (${suffix++})`;
          const copy = { ...clone(template), id, name };
          delete copy.builtin;
          working.push(copy);
          newIds.add(id);
          starterCopies.set(template.id, clone(copy));
        } else {
          working = working.filter((entry) => entry.id !== copyId);
          starterCopies.delete(template.id);
        }
        render();
      });
      row.append(check, label, node("code", "", template.query));
      if (existing) {
        row.append(
          node(
            "small",
            "",
            `${saved.some((item) => JSON.stringify(item) === JSON.stringify(existing)) ? (existing.visible ? "Already in menu" : "Saved · not in menu") : "In this editor · not saved yet"} — ${existing.name}`
          )
        );
        row.append(
          button(
            existing.visible ? "Edit existing" : "Show existing",
            "gprf-view-text-button",
            () => {
              if (existing.visible) edit(existing.id);
              else {
                existing.visible = true;
                render();
              }
            }
          )
        );
      } else if (copyId) row.append(node("small", "", "Added to this editor · Not saved yet"));
      body.append(row);
    }
    return body;
  }
  function picker() {
    const body = node("div", "gprf-saved-menu-scroll");
    for (const entry of visibleViewEntries({ version: 1, entries: saved })) {
      if (entry.type === "divider") {
        body.append(node("div", "gprf-view-separator"));
        continue;
      }
      const item = button(
        "",
        `gprf-saved-option${entry.id === activeId ? " selected" : ""}`,
        () => {
          activeId = entry.id;
          currentQuery = entry.query;
          updateSummary();
          overlay.hide();
          summary.focus();
          status.textContent = `Preview search: ${entry.query}`;
        }
      );
      const copy = node("span", "gprf-view-copy");
      copy.append(node("strong", "", entry.name), node("span", "", entry.description));
      item.append(icon(entry.icon), copy);
      body.append(item);
    }
    const foot = node("div", "gprf-saved-menu-footer");
    foot.append(button("Customize views…", "gprf-view-action", begin));
    menu.append(body, foot);
  }
  function render() {
    menu.replaceChildren();
    if (screen === "picker") {
      delete menu.dataset.mode;
      menu.removeAttribute("role");
      picker();
    } else {
      menu.dataset.mode = screen;
      menu.setAttribute("role", "dialog");
      const editor = node("section", "gprf-views-editor");
      const title =
        screen === "manage"
          ? "Customize views"
          : screen === "starters"
            ? "Add views from templates"
            : "Edit view";
      editor.append(
        header(
          title,
          screen === "manage"
            ? "Cartesian-Systems / cartesian-server"
            : screen === "starters"
              ? "Choose templates, then Save changes"
              : "Changes stay here until you save",
          screen !== "manage"
        )
      );
      if (validated && screen === "form") {
        const target = working.find(
          (entry): entry is SavedView => entry.type === "view" && entry.id === editingId
        );
        if (target && issue(target)) {
          const alert = node(
            "p",
            "gprf-view-error",
            `Finish “${target.name || "Untitled view"}” before saving. Your other changes are still here.`
          );
          alert.setAttribute("role", "alert");
          editor.append(alert);
        }
      }
      editor.append(screen === "manage" ? manage() : screen === "starters" ? starters() : form());
      const latest = deleted.at(-1);
      if (latest) {
        const notice = node("div", "proposal-notice");
        notice.setAttribute("role", "status");
        notice.append(
          node(
            "span",
            "",
            `Deleted ${latest.entry.type === "view" ? `“${latest.entry.name || "Untitled view"}”` : "separator"} · Not saved`
          ),
          button("Undo", "gprf-view-text-button", () => {
            const undo = deleted.pop();
            if (undo) working.splice(Math.min(undo.index, working.length), 0, undo.entry);
            render();
          })
        );
        editor.append(notice);
      }
      if (discard) {
        const confirm = node("div", "gprf-view-confirm");
        confirm.setAttribute("role", "alert");
        const actions = node("div", "gprf-view-actions");
        actions.append(
          button("Keep editing", "gprf-view-button", () => {
            discard = null;
            render();
          }),
          button("Discard changes", "gprf-view-button gprf-view-danger", () => {
            if (discard) exit(discard);
          })
        );
        confirm.append(
          node("strong", "", "Discard all changes in this editor?"),
          node("p", "", "This includes edits, new views, visibility, order, and deletions."),
          actions
        );
        editor.append(confirm);
      }
      editor.append(footer());
      menu.append(editor);
    }
    if (host.isConnected) overlay.show();
  }
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    if (menu.matches(":popover-open")) {
      if (screen === "picker") overlay.hide();
      else requestExit("closed");
    } else {
      screen = "picker";
      render();
    }
  });
  shell.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      !(target instanceof Node) ||
      menu.contains(target) ||
      control.contains(target) ||
      !menu.matches(":popover-open")
    )
      return;
    if (screen === "picker") overlay.hide();
    else requestExit("closed");
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (screen === "picker") overlay.hide();
      else requestExit("closed");
    }
  });
  if (args.screen === "draft" || args.screen === "validation") {
    const id = `new-${++serial}`;
    newIds.add(id);
    working.unshift({
      type: "view",
      id,
      name: "Release triage",
      description: "",
      query: "",
      icon: "filter",
      visible: true,
      destination: "repository"
    });
    editingId = id;
    screen = args.screen === "validation" ? "form" : "manage";
    validated = args.screen === "validation";
  } else if (args.screen === "hidden") {
    editingId = "builtin-draft";
    screen = "form";
  } else if (args.screen === "deleted") {
    const index = working.findIndex((entry) => entry.id === "builtin-open");
    const entry = working[index];
    if (entry) {
      deleted.push({ entry, index });
      working.splice(index, 1);
    }
  } else screen = args.screen;
  updateSummary();
  queueMicrotask(() => {
    if (!host.isConnected) return;
    render();
    const storyRoot = document.querySelector("#storybook-root");
    if (storyRoot) {
      const cleanup = new MutationObserver(() => {
        if (!host.isConnected) {
          overlay.hide();
          cleanup.disconnect();
        }
      });
      cleanup.observe(storyRoot, { childList: true });
    }
  });
  return host;
}
