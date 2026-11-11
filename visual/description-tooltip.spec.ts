import { expect, test, type Page } from "@playwright/test";

type DescriptionShell = HTMLElement & {
  descriptionStory: { refresh(): void; destroy(): void };
};
const description = "Open and awaiting review, not authored by me";
const rowSelector = '[data-view-id="builtin-needs_review"]';
const tooltipSelector = ".gprf-view-description-tooltip";
async function open(page: Page, story = "hover-and-focus"): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/iframe.html?id=extension-description-reveal--${story}&viewMode=story`);
  await expect(page.locator(".gprf-saved-menu:popover-open")).toBeVisible();
}
async function freezeClock(page: Page): Promise<void> {
  const time = new Date("2030-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}
async function fixtureAction(page: Page, action: "refresh" | "destroy"): Promise<void> {
  await page.evaluate((value) => {
    (document.querySelector(".description-reveal-story") as DescriptionShell).descriptionStory[
      value
    ]();
  }, action);
}
async function expectInsideViewport(page: Page): Promise<void> {
  const bounds = (await page.locator(tooltipSelector).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 8);
}

test("whole-row hover reveals only clipped descriptions after 350ms without resizing rows", async ({
  page
}) => {
  await open(page);
  await freezeClock(page);
  const row = page.locator(rowSelector);
  const tooltip = page.locator(tooltipSelector);
  const menuBounds = await page.locator(".gprf-saved-menu").boundingBox();
  const rowBounds = await row.boundingBox();
  await row.locator("svg").first().hover();
  await page.clock.runFor(200);
  await row.locator("strong").hover();
  await page.clock.runFor(149);
  await expect(tooltip).toBeHidden();
  await page.clock.runFor(1);
  await expect(tooltip).toHaveText(description);
  await expect(tooltip).toBeVisible();
  expect(await row.boundingBox()).toEqual(rowBounds);
  expect(rowBounds!.height).toBe(44);
  expect(await page.locator(".gprf-saved-menu").boundingBox()).toEqual(menuBounds);
  await expect(row.locator("[title]")).toHaveCount(0);
  expect(await row.getAttribute("title")).toBeNull();
  await page.locator('[data-view-id="builtin-open"]').hover();
  await page.clock.runFor(350);
  await expect(tooltip).toBeHidden();
});

test("description remains hoverable and dismisses after leaving both row and tooltip", async ({
  page
}) => {
  await open(page);
  await freezeClock(page);
  const tooltip = page.locator(tooltipSelector);
  await page.locator(rowSelector).hover();
  await page.clock.runFor(350);
  await expect(tooltip).toBeVisible();
  await tooltip.hover();
  await page.clock.runFor(500);
  await expect(tooltip).toBeVisible();
  await page.mouse.move(1000, 800);
  await page.clock.runFor(150);
  await expect(tooltip).toBeHidden();
});

test("keyboard focus announces the full description; Escape dismisses it before the menu", async ({
  page
}) => {
  await open(page);
  const row = page.getByRole("menuitemradio", { name: "Needs review", exact: true });
  const tooltip = page.getByRole("tooltip");
  await row.focus();
  await expect(tooltip).toBeVisible();
  await expect(row).toHaveAccessibleDescription(description);
  await expect(row).toHaveAttribute("aria-describedby", (await tooltip.getAttribute("id"))!);
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(row).toBeFocused();
  await expect(row).toHaveAccessibleDescription(description);
  await expect(row).toHaveAttribute(
    "aria-describedby",
    (await row.locator(".gprf-view-copy > span").getAttribute("id"))!
  );
  await expect(page.locator(".gprf-saved-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".gprf-saved-menu")).toBeHidden();
  await expect(page.locator(".gprf-lifecycle-summary")).toBeFocused();
  await page.locator(".gprf-lifecycle-summary").click();
  await expect(page.locator(".gprf-saved-menu:popover-open")).toBeVisible();
  await row.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(tooltip).toBeHidden();
  await expect(page.getByRole("menuitemradio", { name: "Open", exact: true })).toBeFocused();
});

test("empty descriptions and touch pointers do not open a tooltip", async ({ page }) => {
  await open(page);
  await freezeClock(page);
  await page.locator(rowSelector).dispatchEvent("pointerover", { pointerType: "touch" });
  await page.clock.runFor(500);
  await expect(page.locator(tooltipSelector)).toBeHidden();
  await page.goto("/iframe.html?id=extension-repository-views--mixed-descriptions&viewMode=story");
  const empty = page.locator('[data-view-id="custom-review"]');
  await empty.focus();
  await expect(empty.locator(".gprf-view-copy > span")).toHaveCount(0);
  await expect(page.locator(tooltipSelector)).toBeHidden();
});

test("scrolling hides a description and keyboard navigation reveals the newly visible row", async ({
  page
}) => {
  await open(page, "long-list");
  const tooltip = page.locator(tooltipSelector);
  await page.locator(rowSelector).focus();
  await expect(tooltip).toBeVisible();
  await page.locator(".gprf-saved-menu-scroll").evaluate((element) => {
    element.scrollTop = 200;
  });
  await expect(tooltip).toBeHidden();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const last = page.locator('[data-view-id="team-16"]');
  await expect(last).toBeFocused();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(
    "Open and awaiting review from the platform team, not authored by me"
  );
  await expectInsideViewport(page);
});

test("pending hover is cancelled on leave, menu closure, refresh and edit", async ({ page }) => {
  await open(page);
  await freezeClock(page);
  const row = page.locator(rowSelector);
  const tooltip = page.locator(tooltipSelector);
  await row.hover();
  await page.clock.runFor(100);
  await page.mouse.move(1000, 800);
  await page.clock.runFor(500);
  await expect(tooltip).toBeHidden();
  await row.hover();
  await page.locator(".gprf-lifecycle-summary").click();
  await page.clock.runFor(500);
  await expect(tooltip).toBeHidden();
  await page.locator(".gprf-lifecycle-summary").click();
  await row.hover();
  await fixtureAction(page, "refresh");
  await page.clock.runFor(500);
  await expect(tooltip).toBeHidden();
  await row.hover();
  await page.locator(".gprf-customize-views").click();
  await page.clock.runFor(500);
  await expect(tooltip).toBeHidden();
  await expect(page.locator(".gprf-view-editor-header")).toBeVisible();
});

test("destroy cancels a pending hover and removes the tooltip's document listeners", async ({
  page
}) => {
  await open(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await freezeClock(page);
  await page.locator(rowSelector).hover();
  await page.clock.runFor(100);
  await fixtureAction(page, "destroy");
  await page.clock.runFor(500);
  await expect(page.locator(tooltipSelector)).toHaveCount(0);
  await page.getByLabel("Current GitHub search").focus();
  const prevented = await page.evaluate(() => {
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(escape);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
    return escape.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(errors).toEqual([]);
});

test("visible tooltip is cleaned up on refresh, selection, outside click and destroy", async ({
  page
}) => {
  await open(page);
  const row = page.locator(rowSelector);
  const tooltip = page.locator(tooltipSelector);
  await row.focus();
  await expect(tooltip).toBeVisible();
  await fixtureAction(page, "refresh");
  await expect(tooltip).toBeHidden();
  await row.focus();
  await expect(tooltip).toBeVisible();
  await row.click();
  await expect(tooltip).toBeHidden();
  await expect(page.locator(".gprf-saved-menu")).toBeHidden();
  await page.locator(".gprf-lifecycle-summary").click();
  await expect(page.locator(".gprf-saved-menu:popover-open")).toBeVisible();
  await row.focus();
  await expect(tooltip).toBeVisible();
  await page.getByLabel("Current GitHub search").click();
  await expect(tooltip).toBeHidden();
  await expect(page.locator(".gprf-saved-menu")).toBeHidden();
  await page.locator(".gprf-lifecycle-summary").click();
  await expect(page.locator(".gprf-saved-menu:popover-open")).toBeVisible();
  await row.focus();
  await expect(tooltip).toBeVisible();
  await fixtureAction(page, "destroy");
  await expect(tooltip).toHaveCount(0);
});

test("tooltip flips left near the right edge and wraps within a narrow viewport", async ({
  page
}) => {
  await open(page, "near-right-edge");
  const tooltip = page.locator(tooltipSelector);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("data-side", "left");
  await expectInsideViewport(page);
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(tooltip).toBeHidden();
  await open(page, "long-description");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("data-side", "below");
  await expectInsideViewport(page);
  expect((await tooltip.boundingBox())!.height).toBeGreaterThan(54);
});

test("dark and forced-colors themes keep the description readable", async ({ page }) => {
  await open(page, "dark");
  const tooltip = page.locator(tooltipSelector);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveCSS("background-color", "rgb(61, 68, 77)");
  await expect(tooltip).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.emulateMedia({ forcedColors: "active" });
  const colors = await tooltip.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor, style.borderTopColor];
  });
  expect(colors[0]).not.toBe(colors[1]);
  expect(colors[0]).toBe(colors[2]);
});
