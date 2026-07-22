import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  createLifecycleControl,
  type LifecycleControlConfiguration
} from "../src/lifecycle-control";
import { createDefaultLifecycleLayout, setLifecycleVisibility } from "../src/lifecycle-layout";
import type { ActiveLifecycleSelection, Lifecycle } from "../src/lifecycle";
import { LIFECYCLE_OPTIONS, customLifecycleOption } from "../src/lifecycle-options";
import { OCTICONS } from "../src/octicons";
import { createIcon } from "../src/ui-primitives";

type Theme = "light" | "dark" | "high-contrast";
type CustomHelpPlacement = "expanded-only" | "both";

interface StoryArgs {
  lifecycle: Lifecycle;
  count: string;
  expanded: boolean;
  theme: Theme;
}

const COUNTS: Readonly<Record<Lifecycle, string>> = {
  all: "1,612",
  needs_review: "23",
  open: "408",
  ready: "356",
  draft: "52",
  closed: "1,204",
  merged: "987",
  closed_unmerged: "217"
};

function lifecycleHref(lifecycle: Lifecycle): string {
  return `#${lifecycle}`;
}

function createControlElement(configuration: LifecycleControlConfiguration): HTMLDetailsElement {
  return createLifecycleControl(configuration).element;
}

function createShell(theme: Theme): HTMLElement {
  const shell = document.createElement("main");
  shell.className = "gprf-storybook-shell";
  shell.dataset.theme = theme;
  return shell;
}

function createCard(
  selection: ActiveLifecycleSelection,
  expanded: boolean,
  count = selection.kind === "preset" ? COUNTS[selection.lifecycle] : ""
): HTMLElement {
  const card = document.createElement("article");
  card.className = `gprf-storybook-card${expanded ? " gprf-storybook-card--expanded" : ""}`;

  const title = document.createElement("div");
  title.className = "gprf-storybook-card-title";
  title.textContent = selection.kind === "preset" ? selection.lifecycle : "custom";

  const control = createControlElement({
    selection,
    count,
    hrefForLifecycle: lifecycleHref,
    exclusive: !expanded
  });
  control.open = expanded;
  card.append(title, control);
  return card;
}

function renderGallery(theme: Theme): HTMLElement {
  const shell = createShell(theme);
  const heading = document.createElement("h1");
  heading.className = "gprf-storybook-title";
  heading.textContent = "Pull request lifecycle control";
  const description = document.createElement("p");
  description.className = "gprf-storybook-description";
  description.textContent = "Every built-in lifecycle rendered with the production DOM and CSS.";
  shell.append(heading, description);

  for (const expanded of [false, true]) {
    const section = document.createElement("section");
    section.className = "gprf-storybook-section";
    const sectionTitle = document.createElement("h2");
    sectionTitle.className = "gprf-storybook-section-title";
    sectionTitle.textContent = expanded ? "Expanded" : "Collapsed";
    const grid = document.createElement("div");
    grid.className = "gprf-storybook-grid";
    for (const option of LIFECYCLE_OPTIONS) {
      grid.append(createCard({ kind: "preset", lifecycle: option.value }, expanded));
    }
    section.append(sectionTitle, grid);
    shell.append(section);
  }
  return shell;
}

function renderInteractive(args: StoryArgs): HTMLElement {
  const shell = createShell(args.theme);
  const frame = document.createElement("div");
  frame.className = "gprf-storybook-interactive";
  const control = createControlElement({
    selection: { kind: "preset", lifecycle: args.lifecycle },
    count: args.count || null,
    hrefForLifecycle: lifecycleHref,
    customizable: true
  });
  control.open = args.expanded;
  frame.append(control);
  shell.append(frame);
  return shell;
}

function renderCustomQuery(theme: Theme, unsafe: boolean): HTMLElement {
  const shell = createShell(theme);
  const frame = document.createElement("div");
  frame.className = "gprf-storybook-interactive";
  const control = createControlElement({
    selection: { kind: "custom", reason: unsafe ? "correlated" : "partial" },
    count: unsafe ? null : "17",
    hrefForLifecycle: unsafe ? () => null : lifecycleHref,
    customizable: true,
    exclusive: false
  });
  control.open = true;
  frame.append(control);
  shell.append(frame);
  return shell;
}

let customHelpSequence = 0;

function createSummaryHelp(text: string): HTMLElement {
  customHelpSequence += 1;
  const help = document.createElement("span");
  help.className = "gprf-custom-help gprf-custom-help--summary";
  const icon = createIcon(document, OCTICONS.question);
  icon.classList.add("gprf-custom-help-icon");
  const tooltip = document.createElement("span");
  tooltip.id = `gprf-custom-help-${customHelpSequence}`;
  tooltip.className = "gprf-custom-help-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.textContent = text;
  help.append(icon, tooltip);
  help.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    help.classList.toggle("is-open");
  });
  return help;
}

function decorateSummaryHelp(control: HTMLDetailsElement): void {
  const explanation = customLifecycleOption("correlated").help;
  const summary = control.querySelector<HTMLElement>(".gprf-lifecycle-summary");
  const summaryCopy = summary?.querySelector<HTMLElement>(".gprf-summary-copy");
  if (summary && summaryCopy) {
    const help = createSummaryHelp(explanation);
    summary.classList.add("has-custom-help");
    summary.setAttribute(
      "aria-describedby",
      help.querySelector<HTMLElement>(".gprf-custom-help-tooltip")?.id ?? ""
    );
    summaryCopy.append(help);
  }
}

function renderCustomHelpPlacement(theme: Theme): HTMLElement {
  const shell = createShell(theme);
  const heading = document.createElement("h1");
  heading.className = "gprf-storybook-title";
  heading.textContent = "Custom query help placement";
  const description = document.createElement("p");
  description.className = "gprf-storybook-description";
  description.textContent =
    "Compare a contextual help icon only inside the menu with repeating it in the compact selector.";
  const grid = document.createElement("div");
  grid.className = "gprf-storybook-grid gprf-custom-help-grid";
  const treatments: readonly [CustomHelpPlacement, string, string][] = [
    ["expanded-only", "Expanded only", "Selected: contextual without changing the compact header"],
    [
      "both",
      "Compact + expanded",
      "More discoverable before opening, but adds permanent header density"
    ]
  ];

  for (const [placement, label, detail] of treatments) {
    const card = document.createElement("article");
    card.className = "gprf-storybook-card gprf-custom-help-card";
    card.dataset.placement = placement;
    const title = document.createElement("div");
    title.className = "gprf-storybook-card-title";
    title.textContent = label;
    const note = document.createElement("div");
    note.className = "gprf-storybook-card-note";
    note.textContent = detail;
    const compactLabel = document.createElement("div");
    compactLabel.className = "gprf-storybook-preview-label";
    compactLabel.textContent = "Compact";
    const compact = createControlElement({
      selection: { kind: "custom", reason: "correlated" },
      count: null,
      hrefForLifecycle: () => null,
      customizable: true,
      exclusive: false
    });
    if (placement === "both") {
      decorateSummaryHelp(compact);
    }

    const expandedLabel = document.createElement("div");
    expandedLabel.className = "gprf-storybook-preview-label";
    expandedLabel.textContent = "Expanded";
    const expandedFrame = document.createElement("div");
    expandedFrame.className = "gprf-custom-help-expanded";
    const expanded = createControlElement({
      selection: { kind: "custom", reason: "correlated" },
      count: null,
      hrefForLifecycle: () => null,
      customizable: true,
      exclusive: false
    });
    expanded.open = true;
    if (placement === "both") {
      decorateSummaryHelp(expanded);
    }
    expandedFrame.append(expanded);
    card.append(title, note, compactLabel, compact, expandedLabel, expandedFrame);
    grid.append(card);
  }

  shell.append(heading, description, grid);
  return shell;
}

function renderHiddenActiveGallery(theme: Theme): HTMLElement {
  const shell = createShell(theme);
  const heading = document.createElement("h1");
  heading.className = "gprf-storybook-title";
  heading.textContent = "Hidden active lifecycle states";
  const description = document.createElement("p");
  description.className = "gprf-storybook-description";
  description.textContent =
    "Each lifecycle is active while hidden from the user's normal menu configuration.";
  const grid = document.createElement("div");
  grid.className = "gprf-storybook-grid";

  for (const option of LIFECYCLE_OPTIONS) {
    const card = document.createElement("article");
    card.className = "gprf-storybook-card gprf-storybook-card--expanded";
    card.dataset.lifecycle = option.value;
    const title = document.createElement("div");
    title.className = "gprf-storybook-card-title";
    title.textContent = option.label;
    const layout = setLifecycleVisibility(createDefaultLifecycleLayout(), option.value, false);
    const control = createControlElement({
      selection: { kind: "preset", lifecycle: option.value },
      count: COUNTS[option.value],
      hrefForLifecycle: lifecycleHref,
      customizable: true,
      exclusive: false,
      layout
    });
    control.open = true;
    card.append(title, control);
    grid.append(card);
  }
  shell.append(heading, description, grid);
  return shell;
}

function renderActiveTreatmentGallery(theme: Theme): HTMLElement {
  const shell = createShell(theme);
  const heading = document.createElement("h1");
  heading.className = "gprf-storybook-title";
  heading.textContent = "Active state treatments";
  const description = document.createElement("p");
  description.className = "gprf-storybook-description";
  description.textContent =
    "The same selected state rendered with four possible selection indicators.";
  const grid = document.createElement("div");
  grid.className = "gprf-storybook-grid";
  const treatments = [
    ["row-accent", "Row accent", "Chosen production treatment"],
    ["trailing", "Trailing check", "Previous implementation"],
    ["leading", "Leading check", "Primer single-select anatomy"],
    ["icon", "Selected icon", "Semantic icon gains a subtle accent ring"]
  ] as const;

  for (const [treatment, label, detail] of treatments) {
    const card = document.createElement("article");
    card.className = `gprf-storybook-card gprf-storybook-card--expanded gprf-treatment gprf-treatment--${treatment}`;
    card.dataset.treatment = treatment;
    const title = document.createElement("div");
    title.className = "gprf-storybook-card-title";
    title.textContent = label;
    const note = document.createElement("div");
    note.className = "gprf-storybook-card-note";
    note.textContent = detail;
    const control = createControlElement({
      selection: { kind: "preset", lifecycle: "closed_unmerged" },
      count: COUNTS.closed_unmerged,
      hrefForLifecycle: lifecycleHref,
      customizable: true,
      exclusive: false
    });
    control.open = true;
    card.append(title, note, control);
    grid.append(card);
  }

  shell.append(heading, description, grid);
  return shell;
}

const meta: Meta<StoryArgs> = {
  title: "Extension/Lifecycle control",
  args: {
    lifecycle: "open",
    count: "408",
    expanded: true,
    theme: "light"
  },
  argTypes: {
    lifecycle: { control: "select", options: LIFECYCLE_OPTIONS.map(({ value }) => value) },
    theme: { control: "select", options: ["light", "dark", "high-contrast"] }
  },
  render: renderInteractive
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Interactive = {} satisfies Story;

export const Configuring = {
  render: (args) => {
    const shell = renderInteractive({ ...args, expanded: true });
    shell.querySelector<HTMLButtonElement>(".gprf-configure-action")?.click();
    return shell;
  },
  parameters: { controls: { include: ["lifecycle", "theme"] } }
} satisfies Story;

export const ConfiguringDark = {
  args: { lifecycle: "needs_review", theme: "dark", expanded: true },
  render: (args) => Configuring.render(args),
  parameters: { controls: { disable: true } }
} satisfies Story;

export const HiddenActiveState = {
  render: (args) => renderHiddenActiveGallery(args.theme),
  parameters: { controls: { include: ["theme"] } }
} satisfies Story;

export const CustomQuery = {
  render: (args) => renderCustomQuery(args.theme, false),
  parameters: { controls: { include: ["theme"] } }
} satisfies Story;

export const UnsafeBooleanQuery = {
  render: (args) => renderCustomQuery(args.theme, true),
  parameters: { controls: { include: ["theme"] } }
} satisfies Story;

export const CustomHelpPlacement = {
  render: (args) => renderCustomHelpPlacement(args.theme),
  parameters: { controls: { include: ["theme"] } }
} satisfies Story;

export const ActiveStateTreatments = {
  render: (args) => renderActiveTreatmentGallery(args.theme),
  parameters: { controls: { include: ["theme"] } }
} satisfies Story;

export const AllStatesLight = {
  render: () => renderGallery("light"),
  parameters: { controls: { disable: true } }
} satisfies Story;

export const AllStatesDark = {
  render: () => renderGallery("dark"),
  parameters: { controls: { disable: true } }
} satisfies Story;

export const HighContrast = {
  args: { lifecycle: "needs_review", theme: "high-contrast" }
} satisfies Story;

export const NarrowExpanded = {
  args: { lifecycle: "closed_unmerged", count: "217", expanded: true },
  render: (args) => {
    const shell = createShell(args.theme);
    const frame = document.createElement("div");
    frame.className = "gprf-storybook-narrow";
    const control = createControlElement({
      selection: { kind: "preset", lifecycle: args.lifecycle },
      count: args.count,
      hrefForLifecycle: lifecycleHref
    });
    control.open = true;
    frame.append(control);
    shell.append(frame);
    return shell;
  }
} satisfies Story;
