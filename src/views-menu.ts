import { OCTICONS } from "./octicons";
import { createIcon } from "./ui-primitives";
import { createMenuOverlay } from "./menu-overlay";
import { createViewDescriptionTooltip } from "./view-description-tooltip";
import { createViewsEditor } from "./views-editor";
import {
  matchSavedView,
  visibleViewEntries,
  viewDestinationUrl,
  type SavedView,
  type ScopedView
} from "./saved-views";
import type { ViewScopeSnapshot } from "./views-storage";

export interface ViewsMenuState {
  repository: string;
  pageUrl: string;
  query: string;
  count: string | null;
  repositorySnapshot: ViewScopeSnapshot;
}
const EDIT_START = "gprf:views-edit-start";
export function createViewsMenu(
  doc: Document,
  initial: ViewsMenuState,
  onSave: (update: ViewScopeSnapshot) => Promise<ViewScopeSnapshot>
) {
  const element = doc.createElement("details");
  element.className = "gprf-lifecycle gprf-lifecycle--preview gprf-saved-views";
  const summary = doc.createElement("summary");
  summary.className = "gprf-lifecycle-summary";
  const copy = doc.createElement("span");
  copy.className = "gprf-summary-copy";
  const count = doc.createElement("span");
  count.className = "gprf-summary-count";
  const name = doc.createElement("span");
  name.className = "gprf-summary-label";
  const chevron = doc.createElement("span");
  chevron.className = "gprf-chevron";
  chevron.setAttribute("aria-hidden", "true");
  copy.append(count, name);
  summary.append(copy, chevron);
  const menu = doc.createElement("div");
  menu.className = "gprf-saved-menu";
  element.append(summary, menu);
  const overlay = createMenuOverlay(element, summary, menu);
  const descriptions = createViewDescriptionTooltip(element, menu);
  const labelPrefix = `gprf-view-${crypto.randomUUID()}`;
  let state = initial;
  let disposed = false;
  let editor: ReturnType<typeof createViewsEditor> | null = null;
  let lastContent = "";
  let activeViewId: string | null = null;
  function reveal(item: HTMLElement | null | undefined): void {
    const scroll = menu.querySelector<HTMLElement>(".gprf-saved-menu-scroll");
    if (!item || !scroll?.contains(item)) return;
    const row = item.getBoundingClientRect();
    const bounds = scroll.getBoundingClientRect();
    if (row.top < bounds.top) scroll.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) scroll.scrollTop += row.bottom - bounds.bottom;
  }
  function focus(selector?: string): void {
    queueMicrotask(() => {
      if (!disposed && element.isConnected)
        (selector ? menu.querySelector<HTMLElement>(selector) : summary)?.focus();
    });
  }
  function close(restoreFocus = false): void {
    descriptions.reset();
    editor?.destroy();
    editor = null;
    lastContent = "";
    element.open = false;
    overlay.hide();
    if (restoreFocus) focus();
  }
  function requestClose(): boolean {
    if (editor) return editor.requestClose();
    close();
    return true;
  }
  function beginEditing(saveCurrent: boolean): void {
    if (!doc.dispatchEvent(new CustomEvent(EDIT_START, { cancelable: true, detail: element })))
      return;
    editor?.destroy();
    descriptions.reset();
    menu.replaceChildren();
    editor = createViewsEditor(doc, state.repositorySnapshot, {
      onSave,
      onModeChange: (mode) => {
        menu.dataset.mode = mode;
        menu.setAttribute("role", "dialog");
        menu.setAttribute("aria-label", `Customize views for ${state.repository}`);
        summary.setAttribute("aria-haspopup", "dialog");
      },
      onExit: (closed, saved) => {
        editor = null;
        if (saved) state = { ...state, repositorySnapshot: saved };
        lastContent = "";
        if (closed) {
          close(true);
          return;
        }
        renderPicker();
        overlay.show();
        focus(saveCurrent ? ".gprf-save-current" : ".gprf-customize-views");
      }
    });
    menu.append(editor.element);
    editor.show(saveCurrent ? state.query || "is:pr state:open" : undefined);
    element.open = true;
    overlay.show();
  }
  function candidates(): ScopedView[] {
    // Old dashboard metadata is preserved in storage, but repository views now
    // always search the current repository. Global layouts are never loaded.
    return state.repositorySnapshot.layout.entries.flatMap((entry) =>
      entry.type === "view"
        ? [{ scope: state.repository, view: { ...entry, destination: "repository" } }]
        : []
    );
  }
  function updateSummary(): void {
    const active = selectedView();
    activeViewId = active?.view.id ?? null;
    const title = active?.view.name ?? "Custom search";
    if (name.textContent !== title) name.textContent = title;
    if (count.textContent !== state.count) count.textContent = state.count;
    count.hidden = state.count === null;
    summary.setAttribute(
      "aria-label",
      `Pull request view: ${title}${state.count === null ? "" : `, ${state.count} results`}`
    );
  }
  function selectedView(): ScopedView | null {
    const views = candidates();
    const remembered = views.find(({ view }) => view.id === activeViewId);
    return (
      (remembered && matchSavedView(state.query, [remembered])) ||
      matchSavedView(state.query, views)
    );
  }
  function renderPicker(): void {
    updateSummary();
    const key = JSON.stringify([
      state.repository,
      state.pageUrl,
      state.query,
      state.repositorySnapshot
    ]);
    if (key === lastContent) return;
    descriptions.reset();
    lastContent = key;
    delete menu.dataset.mode;
    summary.setAttribute("aria-haspopup", "menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Pull request views");
    menu.replaceChildren();
    const active = selectedView();
    const scroll = doc.createElement("div");
    scroll.className = "gprf-saved-menu-scroll";
    function appendView(view: SavedView): void {
      const link = doc.createElement("a");
      link.className = "gprf-saved-option";
      link.dataset.viewId = view.id;
      const href = viewDestinationUrl(
        { ...view, destination: "repository" },
        state.repository,
        state.pageUrl
      );
      if (href) link.href = href;
      link.setAttribute("role", "menuitemradio");
      const selected = active?.view.id === view.id;
      link.setAttribute("aria-checked", String(selected));
      link.classList.toggle("selected", selected);
      const text = doc.createElement("span");
      text.className = "gprf-view-copy";
      const label = doc.createElement("strong");
      label.textContent = view.name;
      label.id = `${labelPrefix}-${scroll.childElementCount}-label`;
      link.setAttribute("aria-labelledby", label.id);
      text.append(label);
      if (view.description.trim()) {
        const description = doc.createElement("span");
        description.textContent = view.description;
        description.id = `${labelPrefix}-${scroll.childElementCount}-description`;
        link.setAttribute("aria-describedby", description.id);
        text.append(description);
      } else link.dataset.singleLine = "true";
      link.append(createIcon(doc, OCTICONS[view.icon]), text);
      if (selected) link.append(createIcon(doc, OCTICONS.check));
      link.addEventListener("click", () => {
        activeViewId = view.id;
        close();
      });
      scroll.append(link);
    }
    let visibleCount = 0;
    for (const entry of visibleViewEntries(state.repositorySnapshot.layout)) {
      if (entry.type === "divider") {
        const divider = doc.createElement("div");
        divider.className = "gprf-view-separator";
        divider.setAttribute("role", "separator");
        scroll.append(divider);
      } else {
        appendView(entry);
        visibleCount++;
      }
    }
    if (!visibleCount) {
      const empty = doc.createElement("p");
      empty.className = "gprf-view-empty";
      empty.textContent = "No visible views. Add or show a view in Customize views.";
      scroll.append(empty);
    }
    const body = doc.createElement("div");
    body.className = "gprf-saved-menu-body";
    body.append(scroll);
    menu.append(body);
    const footer = doc.createElement("div");
    footer.className = "gprf-saved-menu-footer";
    for (const [label, icon, save] of [
      ["Save current search…", "plus", true],
      ["Customize views…", "gear", false]
    ] as const) {
      const action = doc.createElement("button");
      action.type = "button";
      action.className = `gprf-view-action ${save ? "gprf-save-current" : "gprf-customize-views"}`;
      action.setAttribute("role", "menuitem");
      action.disabled = save && state.repositorySnapshot.readOnly;
      action.append(createIcon(doc, OCTICONS[icon]), doc.createTextNode(label));
      action.addEventListener("click", () => beginEditing(save));
      footer.append(action);
    }
    menu.append(footer);
    const items = [...menu.querySelectorAll<HTMLElement>("a[href],button")];
    for (const item of items) item.tabIndex = -1;
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.setAttribute(
      "tabindex",
      "0"
    );
  }
  function refresh(next: ViewsMenuState): void {
    if (disposed) return;
    if (next.repository !== state.repository) {
      activeViewId = null;
      close();
    }
    state = next;
    updateSummary();
    if (editor) editor.refresh(next.repositorySnapshot);
    else {
      renderPicker();
      if (element.open) overlay.show();
    }
  }
  const outside = (event: MouseEvent): void => {
    if (disposed || !element.isConnected || !element.open || event.composedPath().includes(element))
      return;
    if (!requestClose()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const submit = (event: SubmitEvent): void => {
    if (disposed || !element.isConnected) return;
    if (
      editor &&
      event.target instanceof Node &&
      !element.contains(event.target) &&
      !requestClose()
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const competingEditor = (event: Event): void => {
    if (disposed || !element.isConnected) return;
    if ((event as CustomEvent<HTMLElement>).detail !== element && editor && !requestClose())
      event.preventDefault();
  };
  doc.addEventListener("click", outside, true);
  doc.addEventListener("submit", submit, true);
  doc.addEventListener(EDIT_START, competingEditor);
  summary.addEventListener("click", (event) => {
    if (editor) {
      event.preventDefault();
      requestClose();
    }
  });
  element.addEventListener("toggle", () => {
    if (disposed) return;
    if (editor && !element.open) {
      element.open = true;
      overlay.show();
      editor.requestClose();
    } else if (element.open) {
      if (!editor) renderPicker();
      overlay.show();
      if (!editor) reveal(menu.querySelector<HTMLElement>('[aria-checked="true"]'));
    } else {
      descriptions.reset();
      overlay.hide();
    }
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (editor) editor.escape();
      else close(true);
      return;
    }
    if (editor || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    element.open = true;
    overlay.show();
    const items = [...menu.querySelectorAll<HTMLElement>("a[href],button:not([disabled])")];
    const index = items.indexOf(doc.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : index < 0
            ? event.key === "ArrowUp"
              ? items.length - 1
              : 0
            : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
    reveal(items[next]);
  });
  element.addEventListener("focusout", (event) => {
    if (!editor && event.relatedTarget instanceof Node && !element.contains(event.relatedTarget))
      close();
  });
  renderPicker();
  return {
    element,
    refresh,
    close,
    requestClose,
    destroy(): void {
      disposed = true;
      close();
      descriptions.destroy();
      doc.removeEventListener("click", outside, true);
      doc.removeEventListener("submit", submit, true);
      doc.removeEventListener(EDIT_START, competingEditor);
      element.remove();
    }
  };
}
