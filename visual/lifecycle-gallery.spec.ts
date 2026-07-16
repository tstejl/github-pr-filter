import { expect, test } from "@playwright/test";
import { LIFECYCLE_OPTIONS } from "../src/lifecycle-options";

const storyUrl = (story: string): string => (
  `/iframe.html?id=extension-lifecycle-control--${story}&viewMode=story`
);

test("all lifecycle states share the production visual contract", async ({ page }) => {
  await page.goto(storyUrl("all-states-light"));

  const controls = page.locator(".gprf-lifecycle");
  await expect(controls).toHaveCount(LIFECYCLE_OPTIONS.length * 2);
  await expect(page.locator(".gprf-lifecycle[open]")).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(page.locator(".gprf-summary-count:visible")).toHaveCount(LIFECYCLE_OPTIONS.length * 2);

  const labels = await page.locator(".gprf-summary-label").allTextContents();
  expect(labels.slice(0, LIFECYCLE_OPTIONS.length)).toEqual(
    LIFECYCLE_OPTIONS.map(({ label }) => label)
  );

  const firstMenu = page.locator(".gprf-lifecycle[open] .gprf-lifecycle-menu").first();
  await expect(firstMenu.locator(".gprf-lifecycle-option")).toHaveCount(LIFECYCLE_OPTIONS.length);
  await expect(firstMenu.locator(".gprf-lifecycle-option.selected")).toHaveCount(1);
  await expect(firstMenu.locator(".gprf-menu-divider")).toHaveCount(2);

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
  const shellColor = await page.locator(".gprf-storybook-shell").evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  const menuColor = await page.locator(".gprf-lifecycle-menu").first().evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
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
