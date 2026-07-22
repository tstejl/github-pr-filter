import { createLifecycleEditor, type LifecycleEditor } from "./lifecycle-editor";
import {
  cloneLifecycleLayout,
  DEFAULT_LIFECYCLE_LAYOUT,
  isLifecycleVisible,
  type LifecycleLayout,
  visibleLifecycleLayoutEntries
} from "./lifecycle-layout";
import {
  LIFECYCLE_OPTIONS,
  customLifecycleOption,
  type LifecycleDisplayOption,
  type LifecycleOption
} from "./lifecycle-options";
import type { ActiveLifecycleSelection, Lifecycle } from "./lifecycle";
import { OCTICONS } from "./octicons";
import { createIcon, createIconButton, createTextButton } from "./ui-primitives";

export const CONTROL_CLASS = "gprf-lifecycle";

let optionHelpSequence = 0;

export interface LifecycleControlConfiguration {
  readonly selection: ActiveLifecycleSelection;
  readonly hrefForLifecycle: (lifecycle: Lifecycle) => string | null;
  readonly count?: string | null;
  readonly standalone?: boolean;
  readonly options?: readonly LifecycleOption[];
  readonly ownerDocument?: Document;
  readonly exclusive?: boolean;
  readonly customizable?: boolean;
  readonly layout?: LifecycleLayout;
  readonly onApplyLayout?: (layout: LifecycleLayout) => void;
  readonly turboFrame?: string | null;
}

export interface LifecycleControlRefresh {
  readonly selection: ActiveLifecycleSelection;
  readonly hrefForLifecycle: (lifecycle: Lifecycle) => string | null;
  readonly count?: string | null;
  readonly options?: readonly LifecycleOption[];
  readonly layout?: LifecycleLayout;
  readonly turboFrame?: string | null;
}

export interface LifecycleControlController {
  readonly element: HTMLDetailsElement;
  refresh(configuration: LifecycleControlRefresh): void;
  destroy(): void;
}

function createLifecycleOption(
  document: Document,
  lifecycle: LifecycleDisplayOption,
  href: string | null,
  selected: boolean,
  hiddenFromMenu = false,
  turboFrame: string | null = null,
  currentOnly = false
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = `gprf-lifecycle-option${selected ? " selected" : ""}`;
  if (href !== null) {
    link.href = href;
  } else if (currentOnly) {
    link.tabIndex = 0;
  } else {
    const unavailableReason = "This state can’t be changed safely from the current query";
    link.tabIndex = 0;
    link.classList.add("is-disabled");
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("aria-label", `${lifecycle.label}. ${unavailableReason}.`);
    link.title = unavailableReason;
  }
  link.dataset.lifecycle = lifecycle.value;
  link.setAttribute("role", "menuitemradio");
  link.setAttribute("aria-checked", String(selected));
  if (turboFrame && href !== null) {
    link.setAttribute("data-turbo-frame", turboFrame);
  }

  const copy = document.createElement("span");
  copy.className = "gprf-option-copy";
  const optionLabel = document.createElement("span");
  optionLabel.className = "gprf-option-label";
  optionLabel.textContent = lifecycle.label;
  const optionLabelRow = document.createElement("span");
  optionLabelRow.className = "gprf-option-label-row";
  optionLabelRow.append(optionLabel);
  if (lifecycle.value === "custom") {
    optionHelpSequence += 1;
    const helpId = `gprf-option-help-${optionHelpSequence}`;
    const help = document.createElement("span");
    help.className = "gprf-option-help";
    const helpIcon = createIcon(document, OCTICONS.question);
    helpIcon.classList.add("gprf-option-help-icon");
    const tooltip = document.createElement("span");
    tooltip.id = helpId;
    tooltip.className = "gprf-option-help-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = lifecycle.help;
    help.append(helpIcon, tooltip);
    help.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      help.classList.toggle("is-open");
    });
    link.classList.add("has-option-help");
    link.setAttribute("aria-describedby", helpId);
    optionLabelRow.append(help);
  }
  if (hiddenFromMenu) {
    optionLabelRow.classList.add("has-hidden-indicator");
    const hiddenIndicator = document.createElement("span");
    hiddenIndicator.className = "gprf-hidden-indicator";
    hiddenIndicator.setAttribute("role", "img");
    hiddenIndicator.setAttribute("aria-label", "Hidden from menu");
    hiddenIndicator.title = "Hidden from menu";
    hiddenIndicator.append(createIcon(document, OCTICONS.eyeClosed));
    optionLabelRow.append(hiddenIndicator);
  }
  const optionDescription = document.createElement("span");
  optionDescription.className = "gprf-option-description";
  optionDescription.textContent = lifecycle.description;
  const check = createIcon(document, OCTICONS.check);
  check.classList.add("gprf-option-check");
  copy.append(optionLabelRow, optionDescription);
  link.append(createIcon(document, OCTICONS[lifecycle.icon]), copy, check);

  link.addEventListener("click", (event) => {
    if (link.getAttribute("aria-disabled") === "true" || currentOnly) {
      event.preventDefault();
    }
    if (link.getAttribute("aria-disabled") === "true") {
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    link.closest("details")?.removeAttribute("open");
  });
  return link;
}

function selectedOption(
  options: readonly LifecycleOption[],
  selection: ActiveLifecycleSelection
): LifecycleDisplayOption {
  if (selection.kind === "custom") {
    return customLifecycleOption(selection.reason);
  }
  return (
    options.find(({ value }) => value === selection.lifecycle) ??
    LIFECYCLE_OPTIONS.find(({ value }) => value === selection.lifecycle) ??
    LIFECYCLE_OPTIONS[0]
  );
}

function updateSummary(
  summary: HTMLElement,
  selectedLifecycle: LifecycleDisplayOption,
  count: string | null
): void {
  summary.dataset.lifecycle = selectedLifecycle.value;
  const isCustom = selectedLifecycle.value === "custom";
  const visibleLabel = isCustom ? "Custom" : selectedLifecycle.label;
  const countPrefix = count ? `${count} pull requests. ` : "";
  summary.setAttribute(
    "aria-label",
    isCustom
      ? `${countPrefix}Pull request state: Custom. ${selectedLifecycle.description}.`
      : count
        ? `${count} pull requests: ${visibleLabel}`
        : `Pull request state: ${visibleLabel}`
  );
  const summaryLabel = summary.querySelector<HTMLElement>(".gprf-summary-label");
  const summaryCount = summary.querySelector<HTMLElement>(".gprf-summary-count");
  if (!summaryLabel || !summaryCount) {
    return;
  }
  if (summaryLabel.textContent !== visibleLabel) {
    summaryLabel.textContent = visibleLabel;
  }
  const nextCount = count ?? "";
  if (summaryCount.textContent !== nextCount) {
    summaryCount.textContent = nextCount;
  }
  summaryCount.hidden = !count;
}

export function createLifecycleControl({
  selection,
  hrefForLifecycle,
  count = null,
  standalone = false,
  options = LIFECYCLE_OPTIONS,
  ownerDocument = document,
  exclusive = true,
  customizable = false,
  layout = DEFAULT_LIFECYCLE_LAYOUT,
  onApplyLayout,
  turboFrame = null
}: LifecycleControlConfiguration): LifecycleControlController {
  const control = ownerDocument.createElement("details");
  control.className = `${CONTROL_CLASS}${standalone ? " gprf-lifecycle--standalone" : ""}`;
  const activeOption = selectedOption(options, selection);
  let renderedSelection = selection;
  let renderedHrefForLifecycle = hrefForLifecycle;
  let renderedOptions = options;
  let currentLayout = cloneLifecycleLayout(layout);
  let renderedTurboFrame = turboFrame;
  let lastOptionsSignature: string | null = null;
  let editor: LifecycleEditor | null = null;
  let configuring = false;

  const summary = ownerDocument.createElement("summary");
  summary.className = "gprf-lifecycle-summary";
  const summaryCopy = ownerDocument.createElement("span");
  summaryCopy.className = "gprf-summary-copy";
  const summaryCount = ownerDocument.createElement("span");
  summaryCount.className = "gprf-summary-count";
  const summaryLabel = ownerDocument.createElement("span");
  summaryLabel.className = "gprf-summary-label";
  summaryCopy.append(summaryCount, summaryLabel);
  const chevron = ownerDocument.createElement("span");
  chevron.className = "gprf-chevron";
  chevron.setAttribute("aria-hidden", "true");
  summary.append(summaryCopy, chevron);
  updateSummary(summary, activeOption, count);

  const menu = ownerDocument.createElement("div");
  menu.className = "gprf-lifecycle-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Filter by pull request state");
  const header = ownerDocument.createElement("div");
  header.className = "gprf-menu-header";
  const heading = ownerDocument.createElement("div");
  heading.className = "gprf-menu-heading";
  heading.textContent = "Pull request state";
  const actions = ownerDocument.createElement("div");
  actions.className = "gprf-menu-actions";
  const body = ownerDocument.createElement("div");
  body.className = "gprf-menu-body";
  const footer = ownerDocument.createElement("div");
  footer.className = "gprf-menu-footer";
  footer.hidden = true;
  header.append(heading, actions);
  menu.append(header, body, footer);

  const renderOptions = (force = false): void => {
    const activeLifecycle =
      renderedSelection.kind === "preset" ? renderedSelection.lifecycle : null;
    const activeIsHidden =
      activeLifecycle !== null && !isLifecycleVisible(currentLayout, activeLifecycle);
    const visibleEntries = visibleLifecycleLayoutEntries(
      currentLayout,
      renderedOptions,
      activeLifecycle ?? undefined
    );
    const signature = JSON.stringify({
      selection: renderedSelection,
      layout: currentLayout.entries,
      options: renderedOptions.map((option) => [
        option.value,
        option.label,
        option.description,
        option.icon,
        renderedHrefForLifecycle(option.value)
      ]),
      turboFrame: renderedTurboFrame
    });
    if (!force && signature === lastOptionsSignature) {
      return;
    }
    lastOptionsSignature = signature;
    body.replaceChildren();
    if (renderedSelection.kind === "custom") {
      const customOption = customLifecycleOption(renderedSelection.reason);
      body.append(
        createLifecycleOption(ownerDocument, customOption, null, true, false, null, true)
      );
      const divider = ownerDocument.createElement("div");
      divider.className = "gprf-menu-divider";
      divider.setAttribute("role", "separator");
      body.append(divider);
    }
    for (const entry of visibleEntries) {
      if ("type" in entry && entry.type === "divider") {
        const divider = ownerDocument.createElement("div");
        divider.className = "gprf-menu-divider";
        divider.setAttribute("role", "separator");
        body.append(divider);
      } else {
        const option = entry as LifecycleOption;
        const hiddenFromMenu = activeIsHidden && option.value === activeLifecycle;
        body.append(
          createLifecycleOption(
            ownerDocument,
            option,
            renderedHrefForLifecycle(option.value),
            renderedSelection.kind === "preset" && activeLifecycle === option.value,
            hiddenFromMenu,
            renderedTurboFrame
          )
        );
      }
    }
  };

  const renderNormalActions = (): HTMLButtonElement | null => {
    actions.replaceChildren();
    if (!customizable) {
      return null;
    }
    const configure = createIconButton(
      ownerDocument,
      "gprf-menu-action",
      "Customize states",
      OCTICONS.gear
    );
    configure.classList.add("gprf-configure-action");
    configure.addEventListener("click", () => enterConfiguration());
    actions.append(configure);
    return configure;
  };

  const leaveConfiguration = (apply: boolean, restoreFocus = false): void => {
    if (!configuring) {
      return;
    }
    if (apply && editor) {
      currentLayout = editor.getLayout();
      onApplyLayout?.(cloneLifecycleLayout(currentLayout));
    }
    configuring = false;
    editor = null;
    control.classList.remove("gprf-lifecycle--configuring");
    menu.setAttribute("role", "menu");
    heading.textContent = "Pull request state";
    footer.hidden = true;
    footer.replaceChildren();
    const configure = renderNormalActions();
    renderOptions(true);
    if (restoreFocus) {
      configure?.focus();
    }
  };

  const enterConfiguration = (): void => {
    if (configuring) {
      return;
    }
    configuring = true;
    control.classList.add("gprf-lifecycle--configuring");
    menu.setAttribute("role", "dialog");
    heading.textContent = "Customizing this repo";
    editor = createLifecycleEditor({
      ownerDocument,
      layout: currentLayout,
      options: renderedOptions
    });
    body.replaceChildren(editor.element);

    const cancel = createIconButton(
      ownerDocument,
      "gprf-menu-action",
      "Cancel changes",
      OCTICONS.x
    );
    cancel.classList.add("gprf-cancel-action");
    cancel.addEventListener("click", () => {
      leaveConfiguration(false, true);
    });
    const reset = createTextButton(ownerDocument, "gprf-reset-action", "Reset to default");
    reset.title = "Reset the menu for this repository";
    reset.addEventListener("click", () => {
      editor?.setLayout(DEFAULT_LIFECYCLE_LAYOUT);
      leaveConfiguration(true, true);
    });
    const save = createTextButton(ownerDocument, "gprf-save-action", "Save");
    save.setAttribute("aria-label", "Save changes");
    save.addEventListener("click", () => leaveConfiguration(true, true));
    actions.replaceChildren(cancel);
    footer.replaceChildren(reset, save);
    footer.hidden = false;
    cancel.focus();
  };

  renderNormalActions();
  renderOptions();
  control.append(summary, menu);

  summary.addEventListener("click", (event) => {
    if (configuring) {
      event.preventDefault();
    }
  });

  control.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && control.open) {
      event.preventDefault();
      leaveConfiguration(false);
      control.open = false;
      summary.focus();
      return;
    }
    if (configuring || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const optionLinks = [...control.querySelectorAll<HTMLAnchorElement>(".gprf-lifecycle-option")];
    event.preventDefault();
    control.open = true;
    const currentIndex = optionLinks.indexOf(ownerDocument.activeElement as HTMLAnchorElement);
    let nextIndex = currentIndex;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = optionLinks.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % optionLinks.length;
    } else {
      nextIndex =
        currentIndex < 0
          ? optionLinks.length - 1
          : (currentIndex - 1 + optionLinks.length) % optionLinks.length;
    }
    optionLinks[nextIndex]?.focus();
  });

  control.addEventListener("toggle", () => {
    if (!control.open) {
      control.querySelector(".gprf-option-help.is-open")?.classList.remove("is-open");
      leaveConfiguration(false);
      return;
    }
    if (!exclusive) {
      return;
    }
    for (const otherControl of ownerDocument.querySelectorAll<HTMLDetailsElement>(
      `.${CONTROL_CLASS}[open]`
    )) {
      if (otherControl !== control) {
        otherControl.removeAttribute("open");
      }
    }
  });

  const refresh = ({
    selection: nextSelection,
    hrefForLifecycle: nextHrefForLifecycle,
    count: nextCount = null,
    options: nextOptions = LIFECYCLE_OPTIONS,
    layout: nextLayout,
    turboFrame: nextTurboFrame
  }: LifecycleControlRefresh): void => {
    renderedSelection = nextSelection;
    renderedHrefForLifecycle = nextHrefForLifecycle;
    renderedOptions = nextOptions;
    if (nextLayout) {
      currentLayout = cloneLifecycleLayout(nextLayout);
    }
    if (nextTurboFrame !== undefined) {
      renderedTurboFrame = nextTurboFrame;
    }
    updateSummary(summary, selectedOption(renderedOptions, renderedSelection), nextCount);
    if (!configuring) {
      renderOptions();
    }
  };

  return {
    element: control,
    refresh,
    destroy: () => control.remove()
  };
}
