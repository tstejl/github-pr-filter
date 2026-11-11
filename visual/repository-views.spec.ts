import { expect, test, type Page } from "@playwright/test";
import type { ViewScopeSnapshot } from "../src/views-storage";

type StoryControls = {
  writes: ViewScopeSnapshot[];
  setSaveMode(mode: "success" | "failure" | "pending"): void;
  resolveSave(): void;
  refreshCount(count: string | null): void;
  externalChange(): void;
  ownEcho(): void;
  destroy(): void;
};
type StoryShell = HTMLElement & { viewsStory: StoryControls };
async function open(page: Page, story = "picker"): Promise<void> {
  await page.goto(`/iframe.html?id=extension-repository-views--${story}&viewMode=story`);
  await expect(page.locator(".gprf-saved-menu:popover-open")).toBeVisible();
}
async function control(
  page: Page,
  action: "success" | "failure" | "pending" | "resolve" | "external" | "echo" | "count"
): Promise<void> {
  await page.evaluate((value) => {
    const story = (document.querySelector(".gprf-storybook-shell") as StoryShell).viewsStory;
    if (value === "success" || value === "failure" || value === "pending") story.setSaveMode(value);
    else if (value === "resolve") story.resolveSave();
    else if (value === "external") story.externalChange();
    else if (value === "echo") story.ownEcho();
    else story.refreshCount("99");
  }, action);
}
async function writes(page: Page): Promise<ViewScopeSnapshot[]> {
  return page.evaluate(
    () => (document.querySelector(".gprf-storybook-shell") as StoryShell).viewsStory.writes
  );
}

test("picker shows a text summary and supports keyboard navigation", async ({ page }) => {
  await open(page);
  const summary = page.locator(".gprf-lifecycle-summary");
  await expect(summary.locator(".gprf-summary-count")).toHaveText("217");
  await expect(summary.locator(".gprf-summary-label")).toHaveText("Open");
  await expect(summary.locator("svg")).toHaveCount(0);
  await page.locator(".gprf-customize-views").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".gprf-save-current")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".gprf-customize-views")).toBeFocused();
  await expect(page.locator('[role="menuitem"]')).toHaveText([
    "Save current search…",
    "Customize views…"
  ]);
  await expect(page.locator(".gprf-saved-option[href] ")).not.toHaveCount(0);
});

test("editor is repository-only and leaves current GitHub search unchanged on save", async ({
  page
}) => {
  await open(page, "edit-view");
  const search = page.getByLabel("Current GitHub search");
  const current = await search.inputValue();
  await expect(page.locator(".gprf-view-editor-header > p")).toHaveText(
    "cartesian-systems/cartesian-server"
  );
  await expect(page.locator('input[name="scope"],select[name="destination"]')).toHaveCount(0);
  await page.locator('input[name="name"]').fill("Team queue");
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-customize-views")).toBeVisible();
  await expect(search).toHaveValue(current);
  const saved = await writes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.scope).toBe("cartesian-systems/cartesian-server");
  expect(saved[0]?.layout.entries.find((entry) => entry.id === "custom-review")).toMatchObject({
    name: "Team queue"
  });
});

test("new empty, whitespace and icon-only drafts close without confirmation", async ({ page }) => {
  await open(page, "new-view");
  await page.locator('input[name="name"]').fill("  ");
  await page.locator('textarea[name="query"]').fill(" \n ");
  await page.getByRole("button", { name: "Choose view icon" }).click();
  await page.getByRole("button", { name: "Watch icon" }).click();
  await page.locator('.gprf-view-editor-header button[aria-label="Close view editor"]').click();
  await expect(page.locator(".gprf-saved-menu:popover-open")).toHaveCount(0);
  await expect(page.locator(".gprf-view-confirm")).toHaveCount(0);
  await page.locator(".gprf-lifecycle-summary").click();
  await expect(page.locator(".gprf-customize-views")).toBeVisible();
  expect(await writes(page)).toHaveLength(0);
});

test("partial drafts ask before closing and Keep editing retains input", async ({ page }) => {
  await open(page, "new-view");
  await page.locator('input[name="name"]').fill("Partial");
  await page.locator('.gprf-view-editor-header button[aria-label="Close view editor"]').click();
  await expect(page.locator(".gprf-view-confirm")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.locator('input[name="name"]')).toHaveValue("Partial");
  await page.locator('.gprf-view-editor-header button[aria-label="Close view editor"]').click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.locator(".gprf-saved-menu:popover-open")).toHaveCount(0);
});

test("layout changes are staged, discardable, and saved together", async ({ page }) => {
  await open(page, "customize");
  await page.getByRole("checkbox", { name: "Show Ready for me in menu" }).uncheck();
  await page.getByRole("button", { name: "Add separator" }).click();
  expect(await writes(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel changes", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.locator(".gprf-customize-views").click();
  await expect(page.getByRole("checkbox", { name: "Show Ready for me in menu" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Show Ready for me in menu" }).uncheck();
  await page.getByRole("button", { name: "Add separator" }).click();
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-customize-views")).toBeVisible();
  const saved = await writes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.layout.entries.find((entry) => entry.id === "custom-review")).toMatchObject({
    visible: false
  });
  expect(
    saved[0]?.layout.entries.filter((entry) => entry.type === "divider").length
  ).toBeGreaterThan(1);
});

test("keyboard reorder stages separators and retains focus", async ({ page }) => {
  await open(page, "customize");
  const handle = page.locator('[data-move-id="custom-separator"]');
  await handle.focus();
  await handle.press("ArrowUp");
  await expect(page.locator('[data-move-id="custom-separator"]')).toBeFocused();
  await page.locator(".gprf-save-views").click();
  const saved = await writes(page);
  expect(saved[0]?.layout.entries.slice(0, 2).map((entry) => entry.id)).toEqual([
    "custom-separator",
    "custom-review"
  ]);
});

test("failed saves retain the draft and can be retried", async ({ page }) => {
  await open(page, "edit-view");
  await control(page, "failure");
  await page.locator('input[name="name"]').fill("Retry me");
  await page.locator('textarea[name="query"]').fill("author:me");
  await page.locator(".gprf-save-views").click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.locator('input[name="name"]')).toHaveValue("Retry me");
  await expect(page.locator('textarea[name="query"]')).toHaveValue("author:me");
  await control(page, "success");
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-customize-views")).toBeVisible();
  expect(await writes(page)).toHaveLength(2);
});

test("pending save locks controls and ignores its own storage echo", async ({ page }) => {
  await open(page, "edit-view");
  await control(page, "pending");
  await page.locator('input[name="name"]').fill("Pending edit");
  await page.locator(".gprf-save-views").click();
  await expect(page.locator('input[name="name"]')).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close view editor" })).toBeDisabled();
  await control(page, "echo");
  await expect(page.locator(".gprf-view-conflict")).toHaveCount(0);
  await control(page, "resolve");
  await expect(page.locator(".gprf-customize-views")).toBeVisible();
  await expect(
    page.locator(".gprf-saved-option").filter({ hasText: "Pending edit" })
  ).toBeVisible();
  expect(await writes(page)).toHaveLength(1);
});

test("count-only refresh preserves the field, focus, and caret", async ({ page }) => {
  await open(page, "edit-view");
  const name = page.locator('input[name="name"]');
  await name.fill("Typing here");
  await name.evaluate((input: HTMLInputElement) => {
    input.focus();
    input.setSelectionRange(4, 4);
    input.dataset.testIdentity = "same-node";
  });
  await control(page, "count");
  await expect(name).toHaveValue("Typing here");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("data-test-identity", "same-node");
  expect(await name.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(4);
  await expect(page.locator(".gprf-summary-count")).toHaveText("99");
});

test("external update preserves draft and offers an explicit reload", async ({ page }) => {
  await open(page, "edit-view");
  const name = page.locator('input[name="name"]');
  await name.fill("Local draft");
  await name.evaluate((input: HTMLInputElement) => {
    input.focus();
    input.setSelectionRange(4, 4);
  });
  await control(page, "external");
  await expect(name).toHaveValue("Local draft");
  await expect(name).toBeFocused();
  expect(await name.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(4);
  await expect(page.locator(".gprf-view-conflict")).toBeVisible();
  await expect(page.locator(".gprf-save-views")).toBeDisabled();
  await page.getByRole("button", { name: "Reload saved views…" }).click();
  await expect(page.locator(".gprf-view-confirm")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(name).toHaveValue("Local draft");
  await page.getByRole("button", { name: "Reload saved views…" }).click();
  await page.getByRole("button", { name: "Reload views", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Open elsewhere" })).toBeVisible();
  expect(await writes(page)).toHaveLength(0);
});

test("save current search starts a new draft without changing the search", async ({ page }) => {
  await open(page, "save-current-search");
  const current = await page.getByLabel("Current GitHub search").inputValue();
  await expect(page.locator('textarea[name="query"]')).toHaveValue(current);
  await page.locator('input[name="name"]').fill("Saved search");
  await page.locator(".gprf-save-views").click();
  await expect(page.getByLabel("Current GitHub search")).toHaveValue(current);
  expect((await writes(page))[0]?.layout.entries[0]).toMatchObject({
    name: "Saved search",
    query: current
  });
});

test("read-only layouts allow inspection but block changes", async ({ page }) => {
  await open(page, "read-only");
  await expect(page.locator(".gprf-view-error")).toContainText("saved data has been preserved");
  await expect(page.locator(".gprf-add-view")).toBeDisabled();
  await expect(page.locator(".gprf-save-views")).toBeDisabled();
  expect(await writes(page)).toHaveLength(0);
});

test("narrow reduced-motion editor remains usable in a clipped transformed ancestor", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "customize");
  await page.locator(".gprf-storybook-shell").evaluate((shell: HTMLElement) => {
    shell.style.overflow = "hidden";
    shell.style.transform = "translateZ(0)";
  });
  const menu = page.locator(".gprf-saved-menu:popover-open");
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(780);
  const footer = page.locator(".gprf-view-editor-footer");
  await expect(footer).toBeVisible();
  await page.locator(".gprf-editor-body").evaluate((node: HTMLElement) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(footer).toBeVisible();
  await expect(page.locator(".gprf-save-views")).toBeInViewport();
});

test("browser navigation warns about dirty drafts and can be canceled", async ({ page }) => {
  await open(page, "new-view");
  await page.locator('input[name="name"]').click();
  await page.locator('input[name="name"]').fill("Keep this draft");
  const prompt = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await prompt;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(page.isClosed()).toBe(false);
  await expect(page.locator('input[name="name"]')).toHaveValue("Keep this draft");
});

test("unmounting the Storybook editor removes its browser navigation guard", async ({ page }) => {
  await open(page, "new-view");
  await page.locator('input[name="name"]').fill("Unsaved view");
  await page.evaluate(() => document.querySelector(".gprf-storybook-shell")!.remove());
  await expect
    .poll(() =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })
    )
    .toBe(false);
});

test("submitting another form cannot silently discard view edits", async ({ page }) => {
  await open(page, "new-view");
  await page.locator('input[name="name"]').fill("Keep this view");
  const allowed = await page.evaluate(() => {
    const form = document.createElement("form");
    document.body.append(form);
    const submitted = form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.remove();
    return submitted;
  });
  expect(allowed).toBe(false);
  await expect(page.locator(".gprf-view-confirm")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.locator('input[name="name"]')).toHaveValue("Keep this view");
});

test("all views start collapsed with list visibility controls and additive starters", async ({
  page
}) => {
  await open(page, "customize");
  await expect(page.locator(".gprf-view-form")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Show Open in menu", exact: true })
  ).toBeChecked();
  await expect(page.getByRole("button", { name: "Restore defaults", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add from templates…", exact: true })
  ).toBeVisible();
});

test("Back retains several drafts and Save validates the entire session before writing", async ({
  page
}) => {
  await open(page, "new-view");
  await page.getByLabel("View name", { exact: true }).fill("First draft");
  await page.locator(".gprf-view-back").click();
  await expect(page.getByRole("button", { name: "Edit First draft", exact: true })).toContainText(
    "Needs a query"
  );
  await page.locator(".gprf-add-view").click();
  await page.getByLabel("GitHub query", { exact: true }).fill("is:pr label:second");
  await page.locator(".gprf-view-back").click();
  await page.locator(".gprf-save-views").click();
  await expect(page.getByLabel("View name", { exact: true })).toBeFocused();
  await expect(page.getByText("Enter a name.", { exact: true })).toBeVisible();
  expect(await writes(page)).toHaveLength(0);
  await page.getByLabel("View name", { exact: true }).fill("Second draft");
  await page.locator(".gprf-save-views").click();
  await expect(page.getByLabel("View name", { exact: true })).toHaveValue("First draft");
  await expect(page.getByLabel("GitHub query", { exact: true })).toBeFocused();
  expect(await writes(page)).toHaveLength(0);
  await page.getByLabel("GitHub query", { exact: true }).fill("is:pr label:first");
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-customize-views")).toBeVisible();
  const saved = await writes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.layout.entries.slice(0, 2)).toMatchObject([
    { name: "Second draft", query: "is:pr label:second" },
    { name: "First draft", query: "is:pr label:first" }
  ]);
});

test("empty Back quietly removes the new draft and unchanged Save performs no write", async ({
  page
}) => {
  await open(page, "new-view");
  await page.getByLabel("View name", { exact: true }).fill("  ");
  await page.locator(".gprf-view-back").click();
  await expect(page.getByRole("button", { name: "Edit Untitled view", exact: true })).toHaveCount(
    0
  );
  await expect(page.locator(".gprf-view-confirm")).toHaveCount(0);
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-customize-views")).toBeVisible();
  expect(await writes(page)).toHaveLength(0);
});

test("hidden-view details link to the correct checkbox and preserve the edited query", async ({
  page
}) => {
  await open(page, "hidden-view");
  await expect(page.locator(".gprf-view-visibility-status")).toContainText("Not shown in menu");
  await expect(page.locator(".gprf-view-form input[type=checkbox]")).toHaveCount(0);
  await page.getByLabel("View name", { exact: true }).fill("My draft queue");
  await page
    .getByLabel("GitHub query", { exact: true })
    .fill("is:pr state:open draft:true assignee:@me");
  await page.getByRole("button", { name: "Manage visibility", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "Show My draft queue in menu", exact: true });
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toBeInViewport();
  await page.getByRole("button", { name: "Edit My draft queue", exact: true }).click();
  await expect(page.getByLabel("GitHub query", { exact: true })).toHaveValue(
    "is:pr state:open draft:true assignee:@me"
  );
  await page.getByRole("button", { name: "Cancel changes", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.locator(".gprf-customize-views").click();
  await expect(
    page.getByRole("checkbox", { name: "Show Draft in menu", exact: true })
  ).not.toBeChecked();
  expect(await writes(page)).toHaveLength(0);
});

test("Delete and Undo restore hidden built-in edits and separator order before saving", async ({
  page
}) => {
  await open(page, "hidden-view");
  await page.getByLabel("View name", { exact: true }).fill("Edited draft");
  await page.getByRole("button", { name: "Delete view", exact: true }).click();
  await expect(page.locator(".gprf-view-confirm")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Edited draft", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Show Edited draft in menu", exact: true })
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Edit Edited draft", exact: true }).click();
  await expect(page.getByLabel("GitHub query", { exact: true })).toHaveValue(
    "is:pr state:open draft:true"
  );
  await page.locator(".gprf-view-back").click();
  const order = await page
    .locator(".gprf-view-editor-row")
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.entryId));
  await page.getByRole("button", { name: "Delete separator", exact: true }).first().click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(
    await page
      .locator(".gprf-view-editor-row")
      .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.entryId))
  ).toEqual(order);
  await page.locator(".gprf-save-views").click();
  const saved = await writes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.layout.entries.find((entry) => entry.id === "builtin-draft")).toMatchObject({
    name: "Edited draft",
    visible: false
  });
});

test("starters append copies without resetting edited originals and protect subsequently edited copies", async ({
  page
}) => {
  await open(page, "customize");
  await page.getByRole("button", { name: "Edit Open", exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill("My team");
  await page.getByLabel("GitHub query", { exact: true }).fill("is:pr state:open assignee:@me");
  await page.locator(".gprf-view-back").click();
  await page.getByRole("button", { name: "Add from templates…", exact: true }).click();
  await page.getByRole("checkbox", { name: "Open", exact: true }).check();
  await page.locator(".gprf-view-back").click();
  await page.getByRole("button", { name: "Add from templates…", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Open", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "Open", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Open", exact: true }).check();
  await page.locator(".gprf-view-back").click();
  await page.getByRole("button", { name: "Edit Open", exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill("Open copy");
  await page.locator(".gprf-view-back").click();
  await page.getByRole("button", { name: "Add from templates…", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Open", exact: true })).toBeDisabled();
  await expect(
    page.getByText("In this editor · not saved yet — Open copy", { exact: true })
  ).toBeVisible();
  await page.locator(".gprf-save-views").click();
  const saved = await writes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.layout.entries.at(-1)).toMatchObject({
    name: "Open copy",
    query: "is:pr state:open"
  });
  expect(saved[0]?.layout.entries.at(-1)).not.toHaveProperty("builtin");
  expect(saved[0]?.layout.entries.find((entry) => entry.id === "builtin-open")).toMatchObject({
    name: "My team",
    query: "is:pr state:open assignee:@me"
  });
});

test("starter catalog recognizes hidden aliases and stages Show existing explicitly", async ({
  page
}) => {
  await open(page, "hidden-view");
  await page.getByLabel("GitHub query", { exact: true }).fill("draft:true state:open type:pr");
  await page.locator(".gprf-view-back").click();
  await page.getByRole("button", { name: "Add from templates…", exact: true }).click();
  const row = page
    .locator(".gprf-view-starter")
    .filter({ has: page.getByRole("checkbox", { name: "Draft", exact: true }) });
  await expect(row.getByRole("checkbox")).toBeDisabled();
  await row.getByRole("button", { name: "Show existing", exact: true }).click();
  expect(await writes(page)).toHaveLength(0);
  await page.locator(".gprf-save-views").click();
  const saved = await writes(page);
  expect(
    saved[0]?.layout.entries.filter(
      (entry) => entry.type === "view" && entry.query.includes("draft:true")
    )
  ).toHaveLength(1);
  expect(saved[0]?.layout.entries.find((entry) => entry.id === "builtin-draft")).toMatchObject({
    visible: true,
    query: "draft:true state:open type:pr"
  });
});

test("hidden current view retains its name without returning as a picker shortcut", async ({
  page
}) => {
  await open(page, "customize");
  const query = await page.getByLabel("Current GitHub search").inputValue();
  await page.getByRole("checkbox", { name: "Show Open in menu", exact: true }).uncheck();
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-summary-label")).toHaveText("Open");
  await expect(page.locator('.gprf-saved-option[data-view-id="builtin-open"]')).toHaveCount(0);
  await expect(page.getByLabel("Current GitHub search")).toHaveValue(query);
});

test("equivalent views keep their selected identity across reordering and explicit selection", async ({
  page
}) => {
  await open(page, "new-view");
  await page.getByLabel("View name", { exact: true }).fill("Another Open");
  await page.getByLabel("GitHub query", { exact: true }).fill("is:pr state:open");
  await expect(page.locator(".gprf-view-duplicate")).toContainText("Also used by: Open");
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-summary-label")).toHaveText("Open");
  await page.locator(".gprf-customize-views").click();
  await page.locator('[data-move-id="builtin-open"]').press("ArrowUp");
  await page.locator(".gprf-save-views").click();
  await expect(page.locator(".gprf-summary-label")).toHaveText("Open");
  await page.locator(".gprf-saved-option").filter({ hasText: "Another Open" }).click();
  await control(page, "count");
  await expect(page.locator(".gprf-summary-label")).toHaveText("Another Open");
});

test("picker uses uniform 44px rows and centers empty or whitespace-only descriptions", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "mixed-descriptions");
  const rows = page.locator(".gprf-saved-option");
  const metrics = await rows.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        id: (element as HTMLElement).dataset.viewId,
        height: box.height,
        single: element.hasAttribute("data-single-line"),
        descriptions: element.querySelectorAll(".gprf-view-copy > span").length,
        offsets: [...element.querySelectorAll("strong,svg")].map((content) => {
          const child = content.getBoundingClientRect();
          return Math.abs(child.y + child.height / 2 - (box.y + box.height / 2));
        })
      };
    })
  );
  expect(metrics.every((row) => row.height === 44)).toBe(true);
  const singleRows = metrics.filter(
    (row) => row.id === "custom-review" || row.id === "builtin-all"
  );
  expect(singleRows).toHaveLength(2);
  for (const row of singleRows) {
    expect(row.single).toBe(true);
    expect(row.descriptions).toBe(0);
    expect(row.offsets.every((offset) => offset <= 1)).toBe(true);
  }
  const menu = page.locator(".gprf-saved-menu");
  await expect(menu).toHaveAttribute("data-more-below", "false");
  await expect(rows.last()).toBeInViewport();
  expect((await menu.boundingBox())!.height).toBeLessThanOrEqual(560);
});

test("long picker caps the whole panel and keeps the footer fixed during keyboard scrolling", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "long-list");
  const menu = page.locator(".gprf-saved-menu");
  const scroll = menu.locator(".gprf-saved-menu-scroll");
  await expect(menu).toHaveAttribute("data-more-below", "true");
  expect((await menu.boundingBox())!.height).toBe(560);
  const before = await page.locator(".gprf-saved-menu-footer").boundingBox();
  await page.locator(".gprf-customize-views").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const last = page.locator('.gprf-saved-option[data-view-id="team-18"]');
  await expect(last).toBeFocused();
  const rowBounds = (await last.boundingBox())!;
  const scrollBounds = (await scroll.boundingBox())!;
  expect(rowBounds.y).toBeGreaterThanOrEqual(scrollBounds.y - 1);
  expect(rowBounds.y + rowBounds.height).toBeLessThanOrEqual(
    scrollBounds.y + scrollBounds.height + 1
  );
  await expect(menu).toHaveAttribute("data-more-above", "true");
  await expect(menu).toHaveAttribute("data-more-below", "false");
  expect(await page.locator(".gprf-saved-menu-footer").boundingBox()).toEqual(before);
  await page.keyboard.press("Home");
  await expect(menu).toHaveAttribute("data-more-above", "false");
  await expect(menu).toHaveAttribute("data-more-below", "true");
});

test("picker opens above a low anchor and stays inside a short viewport after resizing", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "near-bottom");
  const menu = page.locator(".gprf-saved-menu");
  await expect(menu).toHaveAttribute("data-side", "above");
  const bounds = (await menu.boundingBox())!;
  const anchor = (await page.locator(".gprf-lifecycle-summary").boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(anchor.y - 7);
  await page.setViewportSize({ width: 390, height: 480 });
  await expect
    .poll(async () => {
      const box = (await menu.boundingBox())!;
      return box.x >= 8 && box.y >= 8 && box.x + box.width <= 383 && box.y + box.height <= 473;
    })
    .toBe(true);
  await expect(page.locator(".gprf-customize-views")).toBeInViewport();
  await expect(page.locator(".gprf-save-current")).toBeInViewport();
});
