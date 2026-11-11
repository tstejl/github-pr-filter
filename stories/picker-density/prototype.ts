// Local layout study. No changes to the extension picker, overlay, or storage.
import baseCss from "../../src/content.css?raw";
import menuCss from "../../src/views-menu.css?raw";
import themeCss from "../storybook.css?raw";
import densityCss from "./prototype.css?raw";
import { createDefaultViewLayout, type SavedView, type ViewEntry } from "../../src/saved-views";
import { OCTICONS } from "../../src/octicons";
import { createIcon } from "../../src/ui-primitives";

type Rows = "current" | "uniform" | "content";
type Args = {
  theme: "light" | "dark";
  presentation: "comparison" | "context";
  rows: Rows;
  height: "current" | "fit";
  fixture: "mixed" | "description-cases" | "names-only" | "long";
  anchor: "top" | "bottom";
  maxHeight: number;
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, css = "", text = "") {
  const result = document.createElement(tag);
  result.className = css;
  result.textContent = text;
  return result;
}
function fixture(kind: Args["fixture"]): ViewEntry[] {
  const custom: SavedView = {
    type: "view",
    id: "closed-me",
    name: "Closed by me",
    description: "",
    query: "is:pr state:closed author:@me",
    icon: "gitPullRequestClosed",
    visible: true,
    destination: "repository"
  };
  const defaults = createDefaultViewLayout().entries;
  if (kind === "description-cases")
    return [
      custom,
      {
        ...custom,
        id: "assigned",
        name: "Assigned to me",
        description: "   ",
        icon: "gitPullRequest"
      },
      {
        ...custom,
        id: "needs-review",
        name: "Needs review",
        description: "Open and awaiting review",
        icon: "codeReview"
      },
      {
        ...custom,
        id: "long-name",
        name: "Release triage for the platform and infrastructure team",
        icon: "filter"
      },
      {
        ...custom,
        id: "long-description",
        name: "Release queue",
        description: "Pull requests waiting for a reviewer from the infrastructure team",
        icon: "codeReview"
      },
      { ...custom, id: "draft", name: "My drafts", icon: "gitPullRequestDraft" }
    ];
  const entries: ViewEntry[] = [custom, ...defaults];
  if (kind === "names-only")
    return entries.map((entry) => (entry.type === "view" ? { ...entry, description: "" } : entry));
  if (kind === "long") {
    for (let index = 1; index <= 18; index++)
      entries.push({
        ...custom,
        id: `team-${index}`,
        name:
          ["Platform", "API", "Mobile", "Infrastructure", "Release", "Documentation"][
            (index - 1) % 6
          ] + ` queue ${index}`,
        description: index % 3 === 0 ? "" : "Open work waiting for team review",
        query: `is:pr state:open label:team-${index}`,
        icon: "codeReview"
      });
  }
  return entries;
}

export function createDensityPreview(args: Args): HTMLElement {
  const host = node("div");
  const root = host.attachShadow({ mode: "open" });
  const style = node("style");
  style.textContent = [baseCss, menuCss, themeCss, densityCss].join("\n");
  const shell = node("main", "gprf-storybook-shell");
  shell.dataset.theme = args.theme;
  const page = node("div", "density-page");
  const status = node(
    "p",
    "density-status",
    "Layout study · sample data only · no storage or GitHub navigation"
  );
  status.setAttribute("role", "status");
  shell.append(page);
  root.append(style, shell);
  const entries = fixture(args.fixture);
  const cleanups: (() => void)[] = [];
  const cap = Math.max(320, Math.min(720, Number.isFinite(args.maxHeight) ? args.maxHeight : 560));

  function createPicker(rows: Rows, height: Args["height"], summary?: HTMLElement) {
    let selected = "closed-me";
    const menu = node("div", "gprf-saved-menu density-menu");
    menu.dataset.rows = rows;
    menu.dataset.height = height;
    menu.dataset.presentation = args.presentation;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Pull request views");
    const frame = node("div", "density-scroll-frame");
    const scroll = node("div", "gprf-saved-menu-scroll");
    const hint = node(
      "span",
      "density-sr-only",
      "More views are available by scrolling or using the arrow keys."
    );
    hint.id = `density-hint-${crypto.randomUUID()}`;
    const links: HTMLAnchorElement[] = [];
    function markSelected(id: string) {
      selected = id;
      for (const link of links) {
        const active = link.dataset.viewId === selected;
        link.classList.toggle("selected", active);
        link.setAttribute("aria-checked", String(active));
        link.querySelector(".density-check")?.remove();
        link.tabIndex = active ? 0 : -1;
        if (active) {
          const check = createIcon(document, OCTICONS.check);
          check.classList.add("density-check");
          link.append(check);
        }
      }
    }
    for (const entry of entries) {
      if (entry.type === "divider") {
        const divider = node("div", "gprf-view-separator");
        divider.setAttribute("role", "separator");
        scroll.append(divider);
        continue;
      }
      const link = node("a", "gprf-saved-option");
      link.href = "#";
      link.dataset.viewId = entry.id;
      link.title = entry.query;
      link.setAttribute("role", "menuitemradio");
      const hasDescription =
        rows === "current" ? Boolean(entry.description) : Boolean(entry.description.trim());
      if (!hasDescription) link.dataset.singleLine = "true";
      const copy = node("span", "gprf-view-copy");
      const label = node("strong", "", entry.name);
      label.title = entry.name;
      copy.append(label);
      if (hasDescription) {
        const description = node("span", "", entry.description);
        description.title = entry.description;
        copy.append(description);
      }
      link.append(createIcon(document, OCTICONS[entry.icon]), copy);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        markSelected(entry.id);
        if (summary) {
          summary.firstChild!.textContent = `923  ${entry.name}`;
          hide();
          summary.focus();
        }
        status.textContent = `Preview selection: ${entry.name}. No GitHub navigation or storage write.`;
      });
      links.push(link);
      scroll.append(link);
    }
    markSelected(selected);
    frame.append(scroll, hint);
    menu.append(frame);
    const footer = node("div", "gprf-saved-menu-footer");
    for (const [label, glyph] of [
      ["Save current search…", "plus"],
      ["Customize views…", "gear"]
    ] as const) {
      const button = node("button", "gprf-view-action");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.append(createIcon(document, OCTICONS[glyph]), document.createTextNode(label));
      button.addEventListener("click", () => {
        status.textContent = `Preview only: “${label}” opens the existing in-place editor in the extension.`;
      });
      footer.append(button);
    }
    menu.append(footer);
    function overflow() {
      const overflowing = scroll.scrollHeight > scroll.clientHeight + 1;
      menu.dataset.moreAbove = String(overflowing && scroll.scrollTop > 1);
      menu.dataset.moreBelow = String(
        overflowing && scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1
      );
      hint.hidden = !overflowing;
      if (overflowing) menu.setAttribute("aria-describedby", hint.id);
      else menu.removeAttribute("aria-describedby");
    }
    scroll.addEventListener("scroll", overflow, { passive: true });
    let open = false;
    function position() {
      if (!summary || !open) return;
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const offsetTop = viewport?.offsetTop ?? 0;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const anchor = summary.getBoundingClientRect();
      const below = Math.max(0, offsetTop + viewportHeight - anchor.bottom - 16);
      const above = Math.max(0, anchor.top - offsetTop - 16);
      const natural = scroll.scrollHeight + footer.getBoundingClientRect().height + 10;
      if (height === "fit") {
        const desired = Math.min(cap, natural);
        const flip = desired > below && above > below;
        const available = flip ? above : below;
        menu.style.maxHeight = `${Math.min(cap, Math.max(0, available))}px`;
        const actual = menu.getBoundingClientRect().height;
        menu.style.top = `${flip ? anchor.top - 8 - actual : anchor.bottom + 8}px`;
        menu.dataset.side = flip ? "above" : "below";
      } else {
        const top = Math.max(
          offsetTop + 8,
          Math.min(anchor.bottom + 8, offsetTop + viewportHeight - 88)
        );
        menu.style.top = `${top}px`;
        menu.style.maxHeight = `${Math.max(0, offsetTop + viewportHeight - top - 8)}px`;
        menu.dataset.side = "below";
      }
      menu.style.left = `${Math.max(offsetLeft + 8, Math.min(anchor.left, offsetLeft + viewportWidth - menu.offsetWidth - 8))}px`;
      overflow();
    }
    function show() {
      if (!summary || !host.isConnected) return;
      open = true;
      menu.setAttribute("popover", "manual");
      if (!menu.matches(":popover-open")) menu.showPopover();
      summary.setAttribute("aria-expanded", "true");
      position();
      links.find((link) => link.dataset.viewId === selected)?.scrollIntoView({ block: "nearest" });
      overflow();
    }
    function hide() {
      open = false;
      if (menu.matches(":popover-open")) menu.hidePopover();
      summary?.setAttribute("aria-expanded", "false");
    }
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && summary) {
        event.preventDefault();
        hide();
        summary.focus();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = [...menu.querySelectorAll<HTMLElement>("a,button")];
      const current = items.indexOf(root.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : current < 0
              ? event.key === "ArrowUp"
                ? items.length - 1
                : 0
              : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
      items[next]?.scrollIntoView({ block: "nearest" });
      overflow();
    });
    if (summary) {
      summary.setAttribute("aria-haspopup", "menu");
      summary.setAttribute("aria-expanded", "false");
      summary.addEventListener("click", (event) => {
        event.preventDefault();
        if (open) hide();
        else show();
      });
      summary.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          show();
          links.find((link) => link.dataset.viewId === selected)?.focus();
        }
      });
    } else if (height === "fit") menu.style.maxHeight = `${cap}px`;
    const resize = new ResizeObserver(() => {
      position();
      overflow();
    });
    const onViewport = () => position();
    const outside = (event: Event) => {
      const path = event.composedPath();
      if (open && !path.includes(menu) && summary && !path.includes(summary)) hide();
    };
    queueMicrotask(() => {
      if (!host.isConnected) return;
      resize.observe(menu);
      resize.observe(scroll);
      if (summary) resize.observe(summary);
      overflow();
      if (summary) show();
    });
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    window.visualViewport?.addEventListener("resize", onViewport);
    window.visualViewport?.addEventListener("scroll", onViewport);
    document.addEventListener("pointerdown", outside);
    cleanups.push(() => {
      hide();
      resize.disconnect();
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
      window.visualViewport?.removeEventListener("resize", onViewport);
      window.visualViewport?.removeEventListener("scroll", onViewport);
      document.removeEventListener("pointerdown", outside);
    });
    return menu;
  }

  if (args.presentation === "comparison") {
    page.append(
      node("h1", "", "Picker height and description-free rows"),
      node(
        "p",
        "density-intro",
        "Compare the same saved views. Empty and whitespace-only descriptions leave no second line in either proposal. The blue heading marks the selected uniform design."
      )
    );
    const grid = node("div", "density-comparison");
    for (const option of [
      {
        title: "Previous layout",
        rows: "current",
        height: "current",
        text: "48px minimum per row. The list stops at 400px; name-only rows keep empty space underneath."
      },
      {
        title: "Uniform 44px · Selected",
        rows: "uniform",
        height: "fit",
        text: `44px for every row; name-only content is centered. The whole panel can grow to ${cap}px.`
      },
      {
        title: "Variable-height alternative",
        rows: "content",
        height: "fit",
        text: `32px for a name; 44px with a description. The whole panel can grow to ${cap}px.`
      }
    ] as const) {
      const card = node("section", "density-card");
      if (option.rows === "uniform") card.dataset.recommended = "true";
      const header = node("header");
      header.append(node("h2", "", option.title), node("p", "", option.text));
      card.append(header, createPicker(option.rows, option.height));
      grid.append(card);
    }
    page.append(grid);
  } else {
    page.append(
      node("h1", "density-repository", "Cartesian-Systems / cartesian-server · Pull requests")
    );
    const search = node("input", "density-search");
    search.readOnly = true;
    search.value = "is:pr state:closed author:@me";
    search.setAttribute("aria-label", "Current GitHub search");
    const list = node("section", "density-list");
    if (args.anchor === "bottom") list.append(node("div", "density-anchor-spacer"));
    const toolbar = node("div", "density-toolbar");
    const control = node("details", "gprf-lifecycle gprf-lifecycle--preview");
    const summary = node("summary", "gprf-lifecycle-summary");
    summary.append(node("span", "", "923  Closed by me"), node("span", "gprf-chevron"));
    control.append(summary);
    toolbar.append(control);
    list.append(toolbar);
    for (const title of [
      "Fix pagination when filters change",
      "Improve review assignment defaults",
      "Handle empty search results",
      "Update API documentation",
      "Support more search qualifiers"
    ]) {
      const row = node("article", "density-pr");
      row.append(
        node("strong", "", title),
        node("p", "", "#4821 opened 2 hours ago · review requested")
      );
      list.append(row);
    }
    page.append(search, list);
    shell.append(createPicker(args.rows, args.height, summary));
  }
  page.append(status);
  queueMicrotask(() => {
    const storyRoot = document.querySelector("#storybook-root");
    if (!storyRoot || !host.isConnected) return;
    const cleanup = new MutationObserver(() => {
      if (!host.isConnected) {
        for (const destroy of cleanups) destroy();
        cleanup.disconnect();
      }
    });
    cleanup.observe(storyRoot, { childList: true });
  });
  return host;
}
