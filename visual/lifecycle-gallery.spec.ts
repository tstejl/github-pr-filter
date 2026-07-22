import { expect, test } from "@playwright/test";
import { LIFECYCLE_OPTIONS } from "../src/lifecycle-options";

const storyUrl = (story: string): string =>
  `/iframe.html?id=extension-lifecycle-control--${story}&viewMode=story`;

test("all lifecycle states share the production visual contract", async ({ page }) => {
  await page.goto(storyUrl("all-states-light"));

  const controls = page.locator(".gprf-lifecycle");
  await expect(controls).toHaveCount(LIFECYCLE_OPTIONS.length * 2);
  await expect(page.locator(".gprf-lifecycle[open]")).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(page.locator(".gprf-summary-count:visible")).toHaveCount(
    LIFECYCLE_OPTIONS.length * 2
  );

  const labels = await page.locator(".gprf-summary-label").allTextContents();
  expect(labels.slice(0, LIFECYCLE_OPTIONS.length)).toEqual(
    LIFECYCLE_OPTIONS.map(({ label }) => label)
  );

  const firstMenu = page.locator(".gprf-lifecycle[open] .gprf-lifecycle-menu").first();
  await expect(firstMenu.locator(".gprf-lifecycle-option")).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(firstMenu.locator(".gprf-lifecycle-option.selected")).toHaveCount(1);
  await expect(firstMenu.locator(".gprf-menu-divider")).toHaveCount(3);

  const iconPaths = await firstMenu
    .locator(".gprf-lifecycle-option > .gprf-lifecycle-icon:first-child path")
    .evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
  expect(new Set(iconPaths).size).toBe(LIFECYCLE_OPTIONS.length);

  const menuBox = await firstMenu.boundingBox();
  const expandedCardBox = await firstMenu.locator("xpath=ancestor::article").boundingBox();
  expect(menuBox).not.toBeNull();
  expect(expandedCardBox).not.toBeNull();
  expect(await firstMenu.evaluate((element) => getComputedStyle(element).minWidth)).toBe("248px");
  expect(await firstMenu.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  expect(menuBox?.width).toBeGreaterThan(240);
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
    (expandedCardBox?.y ?? 0) + (expandedCardBox?.height ?? 0)
  );
});

test("dark theme resolves GitHub-compatible tokens", async ({ page }) => {
  await page.goto(storyUrl("all-states-dark"));
  const shellColor = await page
    .locator(".gprf-storybook-shell")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const menuColor = await page
    .locator(".gprf-lifecycle-menu")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(shellColor).toBe("rgb(13, 17, 23)");
  expect(menuColor).toBe("rgb(22, 27, 34)");
});

test("expanded menu remains inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(storyUrl("narrow-expanded"));
  const menu = page.locator(".gprf-lifecycle-menu");
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  await expect(page.locator(".gprf-summary-count")).toHaveText("217");
});

test("configuration mode uses an explicit cancel and action footer", async ({ page }) => {
  await page.goto(storyUrl("configuring"));
  await expect(page.locator(".gprf-lifecycle--configuring")).toHaveCount(1);
  await expect(page.locator(".gprf-editor-row--option")).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(page.locator(".gprf-editor-row--divider")).toHaveCount(3);
  await expect(page.locator(".gprf-menu-heading")).toHaveText("Customizing this repo");
  await expect(page.getByRole("button", { name: "Cancel changes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  const reset = page.getByRole("button", { name: "Reset to default" });
  await expect(reset).toBeVisible();
  await expect(reset).toHaveAttribute("title", "Reset the menu for this repository");
  await expect(page.getByRole("button", { name: "Add separator" })).toBeVisible();
  await expect(page.locator(".gprf-menu-footer:visible")).toHaveCount(1);

  await page.getByRole("button", { name: "Hide Open" }).click();
  await expect(page.getByRole("button", { name: "Show Open" })).toBeVisible();
  await page.locator(".gprf-storybook-shell").click({ position: { x: 340, y: 20 } });
  await expect(page.locator(".gprf-lifecycle--configuring")).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel changes" }).click();
  await expect(page.locator(".gprf-lifecycle--configuring")).toHaveCount(0);
  await expect(page.locator(".gprf-lifecycle[open]")).toHaveCount(1);
  await expect(page.locator('.gprf-lifecycle-option[data-lifecycle="open"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Customize states" })).toBeFocused();
});

test("reset is subtle at rest and immediately applies defaults", async ({ page }) => {
  await page.goto(storyUrl("configuring-dark"));
  await page.getByRole("button", { name: "Hide Open" }).click();
  const reset = page.getByRole("button", { name: "Reset to default" });
  await expect(reset).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await reset.hover();
  await expect(reset).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await reset.click();
  await expect(page.locator(".gprf-lifecycle--configuring")).toHaveCount(0);
  await expect(page.locator(".gprf-lifecycle[open]")).toHaveCount(1);
  await expect(page.locator('.gprf-lifecycle-option[data-lifecycle="open"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Customize states" })).toBeFocused();
});

test("editor rows and actions do not stack hover backgrounds", async ({ page }) => {
  await page.goto(storyUrl("configuring"));
  const row = page.locator('.gprf-editor-row[data-lifecycle="ready"]');
  const visibility = row.getByRole("button", { name: "Hide Ready" });

  await visibility.hover();
  await expect(row).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(visibility).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(visibility).not.toHaveAttribute("aria-pressed");
});

test("editor supports pointer and keyboard reordering plus separator editing", async ({ page }) => {
  await page.goto(storyUrl("configuring"));
  const rows = page.locator(".gprf-editor-row");
  const firstRow = rows.first();
  const firstKey = await firstRow.getAttribute("data-entry-key");
  const firstHandle = firstRow.locator(".gprf-editor-handle");

  await firstHandle.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("data-entry-key", firstKey ?? "");

  const movedHandle = page.locator(`[data-entry-key="${firstKey}"] .gprf-editor-handle`);
  const finalRow = rows.last();
  const finalBox = await finalRow.boundingBox();
  expect(finalBox).not.toBeNull();
  await movedHandle.dragTo(finalRow, {
    targetPosition: { x: 20, y: Math.max(1, (finalBox?.height ?? 2) - 1) }
  });
  await expect(rows.last()).toHaveAttribute("data-entry-key", firstKey ?? "");

  const initialSeparators = await page.locator(".gprf-editor-row--divider").count();
  await page.getByRole("button", { name: "Add separator" }).click();
  await expect(page.locator(".gprf-editor-row--divider")).toHaveCount(initialSeparators + 1);
  await rows.last().getByRole("button", { name: "Remove separator" }).click();
  await expect(page.locator(".gprf-editor-row--divider")).toHaveCount(initialSeparators);
});

test("configuration width animates in both directions", async ({ page }) => {
  await page.goto(storyUrl("interactive"));
  const menu = page.locator(".gprf-lifecycle-menu");
  const closedOption = page.locator('.gprf-lifecycle-option[data-lifecycle="closed"]');
  await expect(menu).toHaveCSS("width", "248px");
  await expect(closedOption).toHaveCSS("box-sizing", "border-box");
  await expect(closedOption).toHaveCSS("height", "50px");

  await page.getByRole("button", { name: "Customize states" }).click();
  await expect(menu).toHaveCSS("width", "304px");
  await expect(menu).toHaveCSS("min-width", "248px");

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(menu).toHaveCSS("width", "248px");
  await expect(page.getByRole("button", { name: "Customize states" })).toBeFocused();
});

test("a hidden active state remains explainable and configurable", async ({ page }) => {
  await page.goto(storyUrl("hidden-active-state"));
  await expect(page.locator(".gprf-lifecycle")).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(page.locator(".gprf-lifecycle-option.selected")).toHaveCount(
    LIFECYCLE_OPTIONS.length
  );
  await expect(page.getByRole("img", { name: "Hidden from menu" })).toHaveCount(
    LIFECYCLE_OPTIONS.length
  );
  await expect(page.locator(".gprf-summary-label")).toHaveText(
    LIFECYCLE_OPTIONS.map(({ label }) => label)
  );

  const draftCard = page.locator('.gprf-storybook-card[data-lifecycle="draft"]');
  const activeDraft = draftCard.locator('.gprf-lifecycle-option[data-lifecycle="draft"]');
  await expect(activeDraft).toHaveClass(/selected/);
  await expect(activeDraft.locator(".gprf-option-description")).toHaveText("Open drafts");
  const hiddenIndicator = activeDraft.getByRole("img", { name: "Hidden from menu" });
  await expect(hiddenIndicator).toBeVisible();
  await expect(hiddenIndicator).toHaveAttribute("title", "Hidden from menu");

  const closedWithoutMergingCard = page.locator(
    '.gprf-storybook-card[data-lifecycle="closed_unmerged"]'
  );
  await expect(
    closedWithoutMergingCard.locator(".gprf-option-label-row.has-hidden-indicator")
  ).toHaveCSS("display", "grid");
  await expect(closedWithoutMergingCard.locator(".gprf-hidden-indicator")).toHaveCSS(
    "margin-top",
    "4px"
  );

  await draftCard.getByRole("button", { name: "Customize states" }).click();
  await expect(draftCard.locator('.gprf-editor-row[data-lifecycle="draft"]')).toHaveClass(
    /is-hidden/
  );
  await expect(draftCard.getByRole("button", { name: "Show Draft" })).toBeVisible();
});

test("active state treatments preserve single-selection semantics", async ({ page }) => {
  await page.goto(storyUrl("active-state-treatments"));
  await expect(page.locator(".gprf-treatment")).toHaveCount(4);
  await expect(
    page.locator('.gprf-treatment [role="menuitemradio"][aria-checked="true"]')
  ).toHaveCount(4);
  await expect(
    page.locator(
      '.gprf-treatment[data-treatment="leading"] .gprf-lifecycle-option.selected .gprf-option-check'
    )
  ).toHaveCSS("grid-column-start", "1");
  await expect(
    page.locator('.gprf-treatment[data-treatment="row-accent"] .gprf-lifecycle-option.selected')
  ).toHaveCSS("box-shadow", /rgb/);
});

test("row accent remains subtle and visible in dark mode", async ({ page }) => {
  await page.goto(`${storyUrl("active-state-treatments")}&args=theme:dark`);
  const selected = page.locator(
    '.gprf-treatment[data-treatment="row-accent"] .gprf-lifecycle-option.selected'
  );
  await expect(selected).toHaveCSS("background-color", "rgba(56, 139, 253, 0.12)");
  await expect(selected).toHaveCSS("box-shadow", /rgb\(88, 166, 255\)/);
  await expect(selected.locator(".gprf-option-check")).toHaveCSS("display", "none");
});

test("Custom query is transient, selected, and excluded from configuration", async ({ page }) => {
  await page.goto(storyUrl("custom-query"));

  await expect(page.locator(".gprf-summary-label")).toHaveText("Custom");
  await expect(page.locator(".gprf-summary-count")).toHaveText("17");
  const custom = page.locator('.gprf-lifecycle-option[data-lifecycle="custom"]');
  await expect(custom).toHaveClass(/selected/);
  await expect(custom).toHaveAttribute("aria-checked", "true");
  await expect(custom.locator(".gprf-option-label")).toHaveText("Custom query");
  await expect(custom.locator(".gprf-option-description")).toHaveText(
    "Current search doesn’t match a preset"
  );
  const customHelp = custom.locator(".gprf-option-help");
  const customTooltip = custom.locator(".gprf-option-help-tooltip");
  await expect(page.locator(".gprf-lifecycle-summary .gprf-option-help")).toHaveCount(0);
  await expect(customHelp).toHaveCount(1);
  await expect(customTooltip).toHaveText(
    "This GitHub query doesn’t exactly match a lifecycle preset. Choose a preset below or edit the search query directly."
  );
  await customHelp.hover();
  await expect(customHelp).toHaveCSS("opacity", "1");
  await expect(customHelp.locator(".gprf-option-help-icon")).toHaveCSS("opacity", "0.8");
  await expect(customTooltip).toBeVisible();
  await expect(customTooltip).toHaveCSS("opacity", "1");
  await expect(custom).toHaveAttribute(
    "aria-describedby",
    (await customTooltip.getAttribute("id")) ?? ""
  );
  await expect(page.locator(".gprf-lifecycle-option")).toHaveCount(LIFECYCLE_OPTIONS.length + 1);

  await page.getByRole("button", { name: "Customize states" }).click();
  await expect(page.locator(".gprf-editor-row--option")).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(page.locator('.gprf-editor-row[data-lifecycle="custom"]')).toHaveCount(0);
});

test("correlated Boolean lifecycle queries disable unsafe preset actions", async ({ page }) => {
  await page.goto(storyUrl("unsafe-boolean-query"));

  await expect(page.locator(".gprf-summary-label")).toHaveText("Custom");
  await expect(page.locator(".gprf-summary-count")).toBeHidden();
  await expect(page.locator('.gprf-lifecycle-option:not([data-lifecycle="custom"])')).toHaveCount(
    LIFECYCLE_OPTIONS.length
  );
  await expect(
    page.locator('.gprf-lifecycle-option:not([data-lifecycle="custom"])[aria-disabled="true"]')
  ).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(
    page.locator('.gprf-lifecycle-option:not([data-lifecycle="custom"])').first()
  ).toHaveAttribute("tabindex", "0");
  await expect(page.locator('.gprf-lifecycle-option[data-lifecycle="custom"]')).not.toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await expect(
    page.locator('.gprf-lifecycle-option[data-lifecycle="custom"] .gprf-option-description')
  ).toHaveText("Presets can’t be applied safely");
  await expect(
    page.locator('.gprf-lifecycle-option[data-lifecycle="custom"] .gprf-option-help-tooltip')
  ).toHaveText(
    "This GitHub query can’t be safely changed by the extension. Edit the search query directly to choose another view."
  );
  await expect(page.locator(".gprf-lifecycle-summary")).toHaveAttribute(
    "aria-label",
    "Pull request state: Custom. Presets can’t be applied safely."
  );
});

test("Custom help placement comparison keeps the recommended treatment contextual", async ({
  page
}) => {
  await page.goto(storyUrl("custom-help-placement"));
  const expandedOnly = page.locator('[data-placement="expanded-only"]');
  const both = page.locator('[data-placement="both"]');

  await expect(expandedOnly.locator(".gprf-lifecycle-summary .gprf-custom-help")).toHaveCount(0);
  await expect(
    expandedOnly.locator(
      '.gprf-custom-help-expanded .gprf-lifecycle-option[data-lifecycle="custom"] .gprf-option-help'
    )
  ).toHaveCount(1);
  await expect(both.locator(".gprf-lifecycle-summary .gprf-custom-help")).toHaveCount(2);
  await expect(
    both.locator(
      '.gprf-custom-help-expanded .gprf-lifecycle-option[data-lifecycle="custom"] .gprf-option-help'
    )
  ).toHaveCount(1);

  const help = expandedOnly.locator(".gprf-custom-help-expanded .gprf-option-help");
  await help.hover();
  await expect(help.locator(".gprf-option-help-tooltip")).toBeVisible();
  await expect(help.locator(".gprf-option-help-tooltip")).toContainText("can’t be safely changed");
  await help.click();
  await expect(expandedOnly.locator(".gprf-custom-help-expanded .gprf-lifecycle")).toHaveAttribute(
    "open",
    ""
  );
  await expect(help).toHaveClass(/is-open/);
  await expandedOnly.locator(".gprf-custom-help-expanded .gprf-lifecycle-summary").click();
  await expect(
    expandedOnly.locator(".gprf-custom-help-expanded .gprf-lifecycle")
  ).not.toHaveAttribute("open", "");
  await expect(help).not.toHaveClass(/is-open/);
});

test("Custom query help follows dark-theme emphasis tokens", async ({ page }) => {
  await page.goto(`${storyUrl("custom-help-placement")}&args=theme:dark`);
  const help = page.locator(
    '[data-placement="expanded-only"] .gprf-custom-help-expanded .gprf-option-help'
  );
  const tooltip = help.locator(".gprf-option-help-tooltip");

  await help.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveCSS("background-color", "rgb(110, 118, 129)");
  await expect(tooltip).toHaveCSS("color", "rgb(255, 255, 255)");
});
