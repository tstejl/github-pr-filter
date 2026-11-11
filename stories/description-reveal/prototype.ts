// Local fixtures exercise the extension picker without GitHub navigation or storage.
import { createViewsMenu, type ViewsMenuState } from "../../src/views-menu";
import { createDefaultViewLayout } from "../../src/saved-views";
import type { ViewScopeSnapshot } from "../../src/views-storage";
import css from "./prototype.css?raw";

type Args = {
  theme: "light" | "dark";
  start: "preview" | "interactive";
  fixture: "example" | "long-description" | "long-list";
  align: "start" | "end";
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function createDescriptionPreview(args: Args): HTMLElement {
  const shell = node("main", "gprf-storybook-shell description-reveal-story");
  shell.dataset.theme = args.theme;
  shell.dataset.align = args.align;
  const style = node("style");
  style.textContent = css;
  const page = node("div", "description-page");
  const search = node("input", "description-search");
  const query = "is:pr state:open draft:false review:required -author:@me";
  search.value = query;
  search.readOnly = true;
  search.setAttribute("aria-label", "Current GitHub search");
  const list = node("section", "description-list");
  const toolbar = node("div", "description-toolbar");
  const layout = createDefaultViewLayout();
  const needsReview = layout.entries.find(
    (entry) => entry.type === "view" && entry.id === "builtin-needs_review"
  );
  if (needsReview?.type === "view") {
    needsReview.query = query;
    needsReview.description =
      args.fixture === "long-description"
        ? "Open and awaiting review, not authored by me. Includes work assigned to my team and excludes pull requests that already have an approval. Use this view to find the next review to pick up before the release, while keeping draft pull requests out of the queue."
        : "Open and awaiting review, not authored by me";
  }
  if (args.fixture === "long-list") {
    for (let index = 1; index <= 16; index++)
      layout.entries.push({
        type: "view",
        id: `team-${index}`,
        name: `Team queue ${index}`,
        description: "Open and awaiting review from the platform team, not authored by me",
        query: `is:pr state:open label:team-${index}`,
        icon: "codeReview",
        visible: true,
        destination: "repository"
      });
  }
  const snapshot: ViewScopeSnapshot = {
    scope: "cartesian-systems/cartesian-server",
    layout,
    revision: "preview",
    readOnly: false
  };
  const base: ViewsMenuState = {
    repository: snapshot.scope,
    pageUrl: `https://github.com/${snapshot.scope}/pulls`,
    query,
    count: "6",
    repositorySnapshot: snapshot
  };
  const controller = createViewsMenu(document, base, async (update) => structuredClone(update));
  toolbar.append(controller.element);
  list.append(toolbar);
  for (const title of [
    "Fix pagination when filters change",
    "Improve review assignment defaults",
    "Handle empty search results",
    "Update API documentation",
    "Support more search qualifiers",
    "Reduce draft notification noise"
  ]) {
    const row = node("article", "description-pr");
    row.append(
      node("strong", "", title),
      node("p", "", "#4821 opened 2 hours ago · review requested")
    );
    list.append(row);
  }
  const note = node(
    "p",
    "description-note",
    "Storybook mock · Hover a truncated row, or focus it with Tab / arrow keys. Escape dismisses the description first. Rows stay 44px high. No GitHub navigation or extension storage."
  );
  note.setAttribute("role", "status");
  page.append(
    node("h1", "", "Cartesian-Systems / cartesian-server · Pull requests"),
    search,
    list,
    note
  );
  shell.append(style, page);
  const menu = controller.element.querySelector<HTMLElement>(".gprf-saved-menu");
  if (!menu) throw new Error("Preview picker is missing");
  let previewTimer = 0;
  const actions = {
    refresh(): void {
      controller.refresh({ ...base, repositorySnapshot: { ...snapshot, revision: "refreshed" } });
    },
    destroy(): void {
      window.clearTimeout(previewTimer);
      controller.destroy();
    }
  };
  Object.assign(shell, { descriptionStory: actions });
  shell.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".gprf-saved-option")) {
      event.preventDefault();
      note.textContent = "Preview selection only. No GitHub navigation or extension storage.";
    }
  });
  queueMicrotask(() => {
    if (!shell.isConnected) return;
    controller.element.open = true;
    if (args.start === "preview")
      previewTimer = window.setTimeout(
        () =>
          menu.querySelector<HTMLAnchorElement>('[data-view-id="builtin-needs_review"]')?.focus(),
        160
      );
    const storyRoot = document.querySelector("#storybook-root");
    if (storyRoot) {
      const cleanup = new MutationObserver(() => {
        if (!shell.isConnected) {
          actions.destroy();
          cleanup.disconnect();
        }
      });
      cleanup.observe(storyRoot, { childList: true });
    }
  });
  return shell;
}
