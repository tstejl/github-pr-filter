import type { Meta, StoryObj } from "@storybook/html-vite";
import { createViewsMenu, type ViewsMenuState } from "../src/views-menu";
import { createDefaultViewLayout } from "../src/saved-views";
import type { ViewScopeSnapshot } from "../src/views-storage";

type Args = {
  theme: "light" | "dark";
  screen: "picker" | "customize" | "edit" | "new" | "save-current" | "starters" | "hidden";
  query: string;
  count: string;
  readOnly: boolean;
  fixture: "standard" | "mixed" | "long";
  anchor: "top" | "bottom";
};
const sampleQuery = "is:pr state:open draft:false -review:approved -author:@me sort:updated-desc";
function render(args: Args): HTMLElement {
  const shell = document.createElement("main");
  shell.className = "gprf-storybook-shell";
  shell.dataset.theme = args.theme;
  const style = document.createElement("style");
  style.textContent = `
    .gprf-sb-page {max-width:1200px; margin:auto;}
    .gprf-sb-heading {font-size:20px;font-weight:500;margin:8px 0 24px;color:var(--fgColor-accent,#0969da)}
    .gprf-sb-search {display:flex;gap:12px;margin-bottom:18px}
    .gprf-sb-search input {flex:1;min-width:0;padding:8px 12px;border:1px solid var(--borderColor-default,#d0d7de);border-radius:6px;background:var(--overlay-bgColor,#f6f8fa);color:inherit;font:inherit}
    .gprf-sb-list {border:1px solid var(--borderColor-default,#d0d7de);border-radius:6px;min-height:720px}
    .gprf-sb-toolbar {padding:9px 16px;min-height:32px;background:var(--control-transparent-bgColor-hover,#f6f8fa);border-bottom:1px solid var(--borderColor-default,#d0d7de)}
    .gprf-sb-pr {padding:17px 20px;border-bottom:1px solid var(--borderColor-muted,#eaeef2)}
    .gprf-sb-pr strong {font-size:14px}.gprf-sb-pr p {font-size:12px;color:var(--fgColor-muted,#656d76);margin:4px 0 0}
    .gprf-sb-status {font-size:12px;color:var(--fgColor-muted,#656d76)}
    @media(max-width:640px){.gprf-storybook-shell{padding:12px}.gprf-sb-heading{font-size:16px}}
  `;
  const page = document.createElement("div");
  page.className = "gprf-sb-page";
  const heading = document.createElement("h1");
  heading.className = "gprf-sb-heading";
  heading.textContent = "Cartesian-Systems / cartesian-server · Pull requests";
  const search = document.createElement("div");
  search.className = "gprf-sb-search";
  const input = document.createElement("input");
  input.readOnly = true;
  input.value = args.query;
  input.setAttribute("aria-label", "Current GitHub search");
  search.append(input);
  const list = document.createElement("section");
  list.className = "gprf-sb-list";
  const toolbar = document.createElement("div");
  toolbar.className = "gprf-sb-toolbar";
  const layout = createDefaultViewLayout();
  layout.entries.unshift(
    {
      type: "view",
      id: "custom-review",
      name: "Ready for me",
      description: "Unapproved PRs from the team",
      query: sampleQuery,
      icon: "codeReview",
      visible: true,
      destination: "repository"
    },
    { type: "divider", id: "custom-separator" }
  );
  if (args.screen === "hidden") {
    const draft = layout.entries.find(
      (entry) => entry.type === "view" && entry.id === "builtin-draft"
    );
    if (draft?.type === "view") draft.visible = false;
  }
  if (args.fixture === "mixed") {
    const custom = layout.entries.find(
      (entry) => entry.type === "view" && entry.id === "custom-review"
    );
    const all = layout.entries.find((entry) => entry.type === "view" && entry.id === "builtin-all");
    if (custom?.type === "view") custom.description = "";
    if (all?.type === "view") all.description = "   ";
  }
  if (args.fixture === "long") {
    for (let index = 1; index <= 18; index++)
      layout.entries.push({
        type: "view",
        id: `team-${index}`,
        name: `Team queue ${index}`,
        description: index % 3 ? "Open work waiting for team review" : "",
        query: `is:pr state:open label:team-${index}`,
        icon: "codeReview",
        visible: true,
        destination: "repository"
      });
  }
  let snapshot: ViewScopeSnapshot = {
    scope: "cartesian-systems/cartesian-server",
    layout,
    revision: "initial",
    readOnly: args.readOnly
  };
  let mode: "success" | "failure" | "pending" = "success";
  let pending: (() => void) | null = null;
  const writes: ViewScopeSnapshot[] = [];
  const status = document.createElement("p");
  status.className = "gprf-sb-status";
  status.setAttribute("role", "status");
  status.textContent =
    "Extension UI · sample data only · no GitHub navigation or extension storage";
  const base: ViewsMenuState = {
    repository: snapshot.scope,
    pageUrl: `https://github.com/${snapshot.scope}/pulls`,
    query: args.query,
    count: args.count,
    repositorySnapshot: snapshot
  };
  const menu = createViewsMenu(document, base, async (update) => {
    writes.push(structuredClone(update));
    if (mode === "failure") throw new Error("Could not save. Your edits are still here.");
    if (mode === "pending")
      await new Promise<void>((resolve) => {
        pending = resolve;
      });
    snapshot = { ...structuredClone(update), revision: JSON.stringify(update.layout) };
    status.textContent = "Saved in this preview. The current GitHub search has not changed.";
    return snapshot;
  });
  Object.assign(shell, {
    viewsStory: {
      writes,
      setSaveMode(value: typeof mode): void {
        mode = value;
      },
      resolveSave(): void {
        pending?.();
        pending = null;
      },
      refreshCount(count: string | null): void {
        menu.refresh({ ...base, count, repositorySnapshot: snapshot });
      },
      externalChange(): void {
        snapshot = {
          ...snapshot,
          revision: `external-${Date.now()}`,
          layout: {
            ...snapshot.layout,
            entries: snapshot.layout.entries.map((entry) =>
              entry.type === "view" && entry.id === "builtin-open"
                ? { ...entry, name: "Open elsewhere" }
                : entry
            )
          }
        };
        menu.refresh({ ...base, repositorySnapshot: snapshot });
      },
      ownEcho(): void {
        const latest = writes.at(-1);
        if (latest)
          menu.refresh({
            ...base,
            repositorySnapshot: { ...latest, revision: JSON.stringify(latest.layout) }
          });
      },
      destroy(): void {
        menu.destroy();
      }
    }
  });
  toolbar.append(menu.element);
  if (args.anchor === "bottom") {
    const spacer = document.createElement("div");
    spacer.style.height = "max(0px, calc(100dvh - 260px))";
    list.append(spacer);
  }
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
    const row = document.createElement("article");
    row.className = "gprf-sb-pr";
    const titleNode = document.createElement("strong");
    titleNode.textContent = title;
    const detail = document.createElement("p");
    detail.textContent = `#${4821 - index} opened ${index + 1} hours ago · review requested`;
    row.append(titleNode, detail);
    list.append(row);
  }
  page.append(heading, search, list, status);
  shell.append(style, page);
  // Keep links interactive without navigating away from Storybook.
  shell.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>(".gprf-saved-option");
    if (link) {
      event.preventDefault();
      status.textContent = `Preview search: ${new URL(link.href).searchParams.get("q") ?? ""}`;
    }
  });
  queueMicrotask(() => {
    if (!menu.element.isConnected) return;
    const storyRoot = document.querySelector("#storybook-root");
    if (storyRoot) {
      const cleanup = new MutationObserver(() => {
        if (!shell.isConnected) {
          menu.destroy();
          cleanup.disconnect();
        }
      });
      cleanup.observe(storyRoot, { childList: true });
    }
    menu.element.open = true;
    if (args.screen === "save-current")
      menu.element.querySelector<HTMLButtonElement>(".gprf-save-current")?.click();
    else if (args.screen !== "picker") {
      menu.element.querySelector<HTMLButtonElement>(".gprf-customize-views")?.click();
      if (args.screen === "edit")
        menu.element.querySelector<HTMLButtonElement>('[data-edit-id="custom-review"]')?.click();
      if (args.screen === "hidden")
        menu.element.querySelector<HTMLButtonElement>('[data-edit-id="builtin-draft"]')?.click();
      if (args.screen === "starters")
        menu.element.querySelector<HTMLButtonElement>(".gprf-starter-link")?.click();
      if (args.screen === "new")
        menu.element.querySelector<HTMLButtonElement>(".gprf-add-view")?.click();
    }
  });
  return shell;
}
const meta = {
  title: "Extension/Repository views",
  render,
  args: {
    theme: "light",
    screen: "picker",
    query: "is:pr state:open",
    count: "217",
    readOnly: false,
    fixture: "standard",
    anchor: "top"
  },
  argTypes: {
    fixture: { control: "select", options: ["standard", "mixed", "long"] },
    anchor: { control: "inline-radio", options: ["top", "bottom"] },
    theme: { control: "inline-radio", options: ["light", "dark"] },
    screen: {
      control: "select",
      options: ["picker", "customize", "edit", "new", "save-current", "starters", "hidden"]
    }
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Extension repository-only picker and editor with local sample data. Customize in place, then Save changes once. Preview links do not navigate away."
      }
    }
  }
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;
export const Picker: Story = {};
export const MixedDescriptions: Story = { args: { fixture: "mixed" } };
export const LongList: Story = { args: { fixture: "long" } };
export const NearBottom: Story = { args: { fixture: "long", anchor: "bottom" } };
export const Customize: Story = { args: { screen: "customize" } };
export const EditView: Story = { args: { screen: "edit" } };
export const HiddenView: Story = { args: { screen: "hidden" } };
export const StarterViews: Story = { args: { screen: "starters" } };
export const NewView: Story = { args: { screen: "new" } };
export const SaveCurrentSearch: Story = { args: { screen: "save-current", query: sampleQuery } };
export const Dark: Story = { args: { theme: "dark", screen: "edit" } };
export const CustomSearch: Story = {
  args: { query: 'is:pr (assignee:@me OR label:"needs review")' }
};
export const ReadOnly: Story = { args: { readOnly: true, screen: "customize" } };
