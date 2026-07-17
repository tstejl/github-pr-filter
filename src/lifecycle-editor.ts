import {
  addLifecycleDivider,
  cloneLifecycleLayout,
  lifecycleLayoutEntryKey,
  moveLifecycleLayoutEntry,
  placeLifecycleLayoutEntry,
  removeLifecycleDivider,
  setLifecycleVisibility,
  type LifecycleLayout
} from "./lifecycle-layout";
import { LIFECYCLE_OPTIONS, type LifecycleOption } from "./lifecycle-options";
import { OCTICONS } from "./octicons";
import { createIcon, createIconButton } from "./ui-primitives";

export interface LifecycleEditor {
  readonly element: HTMLElement;
  getLayout(): LifecycleLayout;
  setLayout(layout: LifecycleLayout): void;
}

interface LifecycleEditorConfiguration {
  readonly ownerDocument: Document;
  readonly layout: LifecycleLayout;
  readonly options?: readonly LifecycleOption[];
}

export function createLifecycleEditor({
  ownerDocument,
  layout: initialLayout,
  options = LIFECYCLE_OPTIONS
}: LifecycleEditorConfiguration): LifecycleEditor {
  const editor = ownerDocument.createElement("div");
  editor.className = "gprf-layout-editor";
  let layout = cloneLifecycleLayout(initialLayout);
  let draggedKey: string | null = null;
  const optionByValue = new Map(options.map((option) => [option.value, option]));

  const render = (): void => {
    const previousPositions = new Map(
      [...editor.querySelectorAll<HTMLElement>(".gprf-editor-row")].map((row) => [
        row.dataset.entryKey ?? "",
        row.getBoundingClientRect()
      ])
    );
    editor.replaceChildren();
    const list = ownerDocument.createElement("div");
    list.className = "gprf-editor-list";
    list.setAttribute("aria-label", "Visible pull request states and section dividers");

    for (const entry of layout.entries) {
      const key = lifecycleLayoutEntryKey(entry);
      const row = ownerDocument.createElement("div");
      row.className = `gprf-editor-row gprf-editor-row--${entry.type}`;
      row.dataset.entryKey = key;

      const handle = createIconButton(
        ownerDocument,
        "gprf-editor-handle",
        `Reorder ${entry.type === "option" ? optionByValue.get(entry.value)?.label : "separator"}`,
        OCTICONS.grabber
      );
      handle.draggable = true;
      handle.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
          return;
        }
        event.preventDefault();
        layout = moveLifecycleLayoutEntry(layout, key, event.key === "ArrowUp" ? -1 : 1);
        render();
        editor
          .querySelector<HTMLButtonElement>(`[data-entry-key="${key}"] .gprf-editor-handle`)
          ?.focus();
      });

      row.addEventListener("dragstart", (event) => {
        draggedKey = key;
        row.classList.add("is-dragging");
        event.dataTransfer?.setData("text/plain", key);
      });
      row.addEventListener("dragend", () => {
        draggedKey = null;
        row.classList.remove("is-dragging");
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        const placement =
          event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
            ? "after"
            : "before";
        row.classList.toggle("is-drag-target-before", placement === "before");
        row.classList.toggle("is-drag-target-after", placement === "after");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("is-drag-target-before", "is-drag-target-after");
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceKey = draggedKey ?? event.dataTransfer?.getData("text/plain");
        if (sourceKey) {
          const placement =
            event.clientY >=
            row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
              ? "after"
              : "before";
          layout = placeLifecycleLayoutEntry(layout, sourceKey, key, placement);
          render();
        }
      });

      if (entry.type === "option") {
        const option = optionByValue.get(entry.value);
        if (!option) {
          continue;
        }
        row.dataset.lifecycle = entry.value;
        row.classList.toggle("is-hidden", !entry.visible);
        const label = ownerDocument.createElement("span");
        label.className = "gprf-editor-label";
        label.textContent = option.label;
        const visibility = createIconButton(
          ownerDocument,
          "gprf-editor-visibility",
          entry.visible ? `Hide ${option.label}` : `Show ${option.label}`,
          entry.visible ? OCTICONS.eye : OCTICONS.eyeClosed
        );
        visibility.addEventListener("click", () => {
          layout = setLifecycleVisibility(layout, entry.value, !entry.visible);
          render();
          editor
            .querySelector<HTMLButtonElement>(
              `[data-lifecycle="${entry.value}"] .gprf-editor-visibility`
            )
            ?.focus();
        });
        row.append(handle, createIcon(ownerDocument, OCTICONS[option.icon]), label, visibility);
      } else {
        const line = ownerDocument.createElement("span");
        line.className = "gprf-editor-divider-line";
        const remove = createIconButton(
          ownerDocument,
          "gprf-editor-remove",
          "Remove separator",
          OCTICONS.trash
        );
        remove.addEventListener("click", () => {
          layout = removeLifecycleDivider(layout, entry.id);
          render();
        });
        row.append(handle, line, remove);
      }
      list.append(row);
    }

    const add = ownerDocument.createElement("button");
    add.type = "button";
    add.className = "gprf-editor-add";
    add.append(createIcon(ownerDocument, OCTICONS.plus), "Add separator");
    add.addEventListener("click", () => {
      layout = addLifecycleDivider(layout);
      render();
      editor
        .querySelector<HTMLButtonElement>(".gprf-editor-row:last-child .gprf-editor-handle")
        ?.focus();
    });
    const addRow = ownerDocument.createElement("div");
    addRow.className = "gprf-editor-add-row";
    addRow.append(add);
    editor.append(list, addRow);

    const reduceMotion = ownerDocument.defaultView?.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (previousPositions.size === 0 || reduceMotion) {
      return;
    }
    for (const row of editor.querySelectorAll<HTMLElement>(".gprf-editor-row")) {
      const previous = previousPositions.get(row.dataset.entryKey ?? "");
      if (!previous) {
        row.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 120,
          easing: "ease-out"
        });
        continue;
      }
      const deltaY = previous.top - row.getBoundingClientRect().top;
      if (Math.abs(deltaY) > 0.5) {
        row.animate([{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }], {
          duration: 160,
          easing: "cubic-bezier(0.33, 1, 0.68, 1)"
        });
      }
    }
  };

  render();
  return {
    element: editor,
    getLayout: () => cloneLifecycleLayout(layout),
    setLayout: (nextLayout) => {
      layout = cloneLifecycleLayout(nextLayout);
      render();
    }
  };
}
