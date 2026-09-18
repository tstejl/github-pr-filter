import { expect, test } from "@playwright/test";

const storyUrl = (story: string): string =>
  `/iframe.html?id=extension-lifecycle-control--${story}&viewMode=story`;

for (const ui of ["classic", "new"]) {
  test(`${ui} selection stays invisible after its close animation finishes`, async ({ page }) => {
    await page.goto(`${storyUrl("interactive")}&args=ui:${ui}`);
    const menu = page.locator(".gprf-lifecycle-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS("opacity", "1");
    const afterAnimation = await menu.evaluate((element) => {
      const option = element.querySelector<HTMLAnchorElement>('[data-lifecycle="ready"]')!;
      // Keep this page in place while exercising the production selection handler.
      option.addEventListener("click", (event) => event.preventDefault(), { once: true });
      option.click();
      // Finish CSS before the timer can run, as happens when navigation delays JS.
      element.getAnimations().forEach((animation) => animation.finish());
      return {
        closing: element.classList.contains("gprf-menu-closing"),
        opacity: getComputedStyle(element).opacity
      };
    });
    expect(afterAnimation).toEqual({ closing: true, opacity: "0" });
    await expect(menu).toBeHidden();
  });
}

test("classic menu stays hidden before opening animation on every expansion", async ({ page }) => {
  await page.goto(`${storyUrl("interactive")}&args=expanded:false;ui:classic`);
  const control = page.locator(".gprf-lifecycle");
  const menu = page.locator(".gprf-lifecycle-menu");
  await expect(control).not.toHaveAttribute("open", "");
  const verifyOpening = async () => {
    const initialDisplay = await control.evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
      const popup = element.querySelector<HTMLElement>(".gprf-lifecycle-menu")!;
      return getComputedStyle(popup).display;
    });
    expect(initialDisplay).toBe("none");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveClass(/gprf-menu-opening/u);
    await page.locator("summary").click();
    await expect(menu).toBeHidden();
  };
  await verifyOpening();
  await verifyOpening();
  await page.locator("summary").press("ArrowDown");
  await expect(page.locator(".gprf-lifecycle-option").first()).toBeFocused();
});

test("summary reopen cancels a pending close", async ({ page }) => {
  await page.goto(storyUrl("preview"));

  const control = page.locator(".gprf-lifecycle");
  const summary = page.locator(".gprf-lifecycle-summary");
  const menu = page.locator(".gprf-lifecycle-menu");

  await summary.click();
  await expect(control).toHaveAttribute("open", "");
  await summary.click();
  await expect(menu).toHaveClass(/gprf-menu-closing/u);

  await summary.click();
  await expect(menu).toHaveClass(/gprf-menu-opening/u);
  await expect(menu).not.toHaveClass(/gprf-menu-closing/u);
  await page.waitForTimeout(160);
  await expect(control).toHaveAttribute("open", "");
  await expect(menu).toBeVisible();
});

test("programmatic reopen invalidates a pending close timer", async ({ page }) => {
  await page.goto(storyUrl("preview"));

  const control = page.locator(".gprf-lifecycle");
  const summary = page.locator(".gprf-lifecycle-summary");
  const menu = page.locator(".gprf-lifecycle-menu");

  await summary.click();
  await summary.click();
  await expect(menu).toHaveClass(/gprf-menu-closing/u);

  await control.evaluate((element) => {
    const details = element as HTMLDetailsElement;
    details.open = false;
    details.open = true;
  });
  await expect(menu).toHaveClass(/gprf-menu-opening/u);
  await page.waitForTimeout(160);
  await expect(control).toHaveAttribute("open", "");
  await expect(menu).toBeVisible();
});

test("arrow navigation reopens a menu before moving focus", async ({ page }) => {
  await page.goto(storyUrl("interactive"));

  const control = page.locator(".gprf-lifecycle");
  const summary = page.locator(".gprf-lifecycle-summary");
  const menu = page.locator(".gprf-lifecycle-menu");
  const firstOption = page.locator(".gprf-lifecycle-option").first();

  await summary.focus();
  await page.keyboard.press("Escape");
  await expect(summary).toBeFocused();
  await expect(menu).toHaveClass(/gprf-menu-closing/u);

  await page.keyboard.press("ArrowDown");
  await expect(firstOption).toBeFocused();
  await expect(menu).toHaveClass(/gprf-menu-opening/u);
  await expect(menu).not.toHaveClass(/gprf-menu-closing/u);
  await page.waitForTimeout(160);
  await expect(control).toHaveAttribute("open", "");
  await expect(firstOption).toBeFocused();
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`an immediate keyboard close survives a queued open toggle (${reducedMotion})`, async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto(storyUrl("preview"));
    const control = page.locator(".gprf-lifecycle");
    await control.evaluate((element) => {
      const summary = element.querySelector("summary")!;
      summary.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
      );
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });
    await page.waitForTimeout(160);
    await expect(control).not.toHaveAttribute("open", "");
    await page.locator("summary").press("ArrowDown");
    await expect(control).toHaveAttribute("open", "");
    await expect(page.locator(".gprf-lifecycle-option").first()).toBeFocused();
  });
}
