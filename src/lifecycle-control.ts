import {
  LIFECYCLE_OPTIONS,
  type Lifecycle,
  type LifecycleOption,
  type LifecyclePreferences
} from "./lifecycle-options";
import { OCTICONS, type Octicon } from "./octicons";

export const CONTROL_CLASS = "gprf-lifecycle";

export interface LifecycleControlConfiguration {
  readonly preferences: LifecyclePreferences;
  readonly hrefForLifecycle: (lifecycle: Lifecycle) => string;
  readonly count?: string | null;
  readonly standalone?: boolean;
  readonly options?: readonly LifecycleOption[];
  readonly ownerDocument?: Document;
  readonly exclusive?: boolean;
}

export interface LifecycleControlRefresh {
  readonly preferences: LifecyclePreferences;
  readonly hrefForLifecycle: (lifecycle: Lifecycle) => string;
  readonly count?: string | null;
  readonly options?: readonly LifecycleOption[];
}

function createIcon(document: Document, icon: Octicon): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("viewBox", icon.viewBox);
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.classList.add("octicon", "gprf-lifecycle-icon");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", icon.path);
  svg.append(path);
  return svg;
}

function createLifecycleOption(
  document: Document,
  lifecycle: LifecycleOption,
  href: string,
  selected: boolean
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = `gprf-lifecycle-option${selected ? " selected" : ""}`;
  link.href = href;
  link.dataset.lifecycle = lifecycle.value;
  link.setAttribute("role", "menuitemradio");
  link.setAttribute("aria-checked", String(selected));

  const copy = document.createElement("span");
  copy.className = "gprf-option-copy";

  const optionLabel = document.createElement("span");
  optionLabel.className = "gprf-option-label";
  optionLabel.textContent = lifecycle.label;

  const optionDescription = document.createElement("span");
  optionDescription.className = "gprf-option-description";
  optionDescription.textContent = lifecycle.description;

  const check = createIcon(document, OCTICONS.check);
  check.classList.add("gprf-option-check");
  copy.append(optionLabel, optionDescription);
  link.append(createIcon(document, OCTICONS[lifecycle.icon]), copy, check);

  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    link.closest("details")?.removeAttribute("open");
  });

  return link;
}

function selectedOption(
  options: readonly LifecycleOption[],
  preferences: LifecyclePreferences
): LifecycleOption {
  return (
    options.find(({ value }) => value === preferences.lifecycle) ??
    options[0] ??
    LIFECYCLE_OPTIONS[0]
  );
}

function updateSummary(
  summary: HTMLElement,
  selectedLifecycle: LifecycleOption,
  count: string | null
): void {
  summary.dataset.lifecycle = selectedLifecycle.value;
  summary.setAttribute(
    "aria-label",
    count
      ? `${count} pull requests: ${selectedLifecycle.label}`
      : `Pull request state: ${selectedLifecycle.label}`
  );

  const summaryLabel = summary.querySelector<HTMLElement>(".gprf-summary-label");
  const summaryCount = summary.querySelector<HTMLElement>(".gprf-summary-count");
  if (!summaryLabel || !summaryCount) {
    return;
  }
  summaryLabel.textContent = selectedLifecycle.label;
  summaryCount.textContent = count ?? "";
  summaryCount.hidden = !count;
}

export function createLifecycleControl({
  preferences,
  hrefForLifecycle,
  count = null,
  standalone = false,
  options = LIFECYCLE_OPTIONS,
  ownerDocument = document,
  exclusive = true
}: LifecycleControlConfiguration): HTMLDetailsElement {
  const control = ownerDocument.createElement("details");
  control.className = `${CONTROL_CLASS}${standalone ? " gprf-lifecycle--standalone" : ""}`;
  const activeOption = selectedOption(options, preferences);

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

  const heading = ownerDocument.createElement("div");
  heading.className = "gprf-menu-heading";
  heading.textContent = "Pull request state";
  menu.append(heading);

  for (const option of options) {
    if (option.startsSection) {
      const divider = ownerDocument.createElement("div");
      divider.className = "gprf-menu-divider";
      divider.setAttribute("role", "separator");
      menu.append(divider);
    }
    menu.append(
      createLifecycleOption(
        ownerDocument,
        option,
        hrefForLifecycle(option.value),
        preferences.lifecycle === option.value
      )
    );
  }

  control.append(summary, menu);

  control.addEventListener("keydown", (event) => {
    const optionLinks = [...control.querySelectorAll<HTMLAnchorElement>(".gprf-lifecycle-option")];
    if (event.key === "Escape" && control.open) {
      event.preventDefault();
      control.open = false;
      summary.focus();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

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
    if (!control.open || !exclusive) {
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

  return control;
}

export function refreshLifecycleControl(
  control: HTMLDetailsElement,
  {
    preferences,
    hrefForLifecycle,
    count = null,
    options = LIFECYCLE_OPTIONS
  }: LifecycleControlRefresh
): void {
  const activeOption = selectedOption(options, preferences);
  const summary = control.querySelector<HTMLElement>(".gprf-lifecycle-summary");
  if (summary) {
    updateSummary(summary, activeOption, count);
  }

  for (const link of control.querySelectorAll<HTMLAnchorElement>(".gprf-lifecycle-option")) {
    const lifecycle = link.dataset.lifecycle;
    if (!lifecycle) {
      continue;
    }
    const selected = lifecycle === preferences.lifecycle;
    link.classList.toggle("selected", selected);
    link.href = hrefForLifecycle(lifecycle as Lifecycle);
    link.setAttribute("aria-checked", String(selected));
  }
}
