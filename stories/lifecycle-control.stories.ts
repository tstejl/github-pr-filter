import type { Meta, StoryObj } from "@storybook/html-vite";
import { createLifecycleControl } from "../src/lifecycle-control";
import {
  LIFECYCLE_OPTIONS,
  type Lifecycle,
  type LifecyclePreferences
} from "../src/lifecycle-options";

type Theme = "light" | "dark" | "high-contrast";

interface StoryArgs {
  lifecycle: Lifecycle;
  count: string;
  expanded: boolean;
  theme: Theme;
}

const COUNTS: Readonly<Record<Lifecycle, string>> = {
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

function createShell(theme: Theme): HTMLElement {
  const shell = document.createElement("main");
  shell.className = "gprf-storybook-shell";
  shell.dataset.theme = theme;
  return shell;
}

function createCard(
  preferences: LifecyclePreferences,
  expanded: boolean,
  count = COUNTS[preferences.lifecycle]
): HTMLElement {
  const card = document.createElement("article");
  card.className = `gprf-storybook-card${expanded ? " gprf-storybook-card--expanded" : ""}`;

  const title = document.createElement("div");
  title.className = "gprf-storybook-card-title";
  title.textContent = preferences.lifecycle;

  const control = createLifecycleControl({
    preferences,
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
      grid.append(createCard({ lifecycle: option.value }, expanded));
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
  const control = createLifecycleControl({
    preferences: { lifecycle: args.lifecycle },
    count: args.count || null,
    hrefForLifecycle: lifecycleHref
  });
  control.open = args.expanded;
  frame.append(control);
  shell.append(frame);
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
    const control = createLifecycleControl({
      preferences: { lifecycle: args.lifecycle },
      count: args.count,
      hrefForLifecycle: lifecycleHref
    });
    control.open = true;
    frame.append(control);
    shell.append(frame);
    return shell;
  }
} satisfies Story;
