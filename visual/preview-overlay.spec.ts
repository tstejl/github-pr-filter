import { expect, test } from "@playwright/test";

const preview = "/iframe.html?id=extension-lifecycle-control--preview&viewMode=story";

test("preview menu escapes clipped and transformed list ancestors", async ({ page }) => {
  await page.goto(preview);
  await page.locator(".gprf-lifecycle").evaluate((control) => {
    // The capture places the metadata/control within ListView's list container.
    // Exercise both clipping and a containing block, without changing GitHub CSS.
    const list = document.createElement("div");
    list.className =
      "ListView-module__container__CfCNF SharedListContainer-module__listContainer__A4WkZ";
    list.style.cssText = "height:140px;overflow:hidden;transform:translateZ(0);position:relative";
    control.before(list);
    list.append(control);
  });
  const menu = page.locator(".gprf-lifecycle-menu");
  await page.locator("summary").click();
  await expect(menu).toHaveJSProperty("popover", "manual");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("position", "fixed");
  await expect.poll(() => menu.evaluate((element) => element.matches(":popover-open"))).toBe(true);
  const last = page.locator(".gprf-lifecycle-option").last();
  await expect
    .poll(() =>
      last.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + 20, rect.y + rect.height / 2));
      })
    )
    .toBe(true);
  await page.locator(".gprf-configure-action").click();
  await expect(page.locator(".gprf-save-action")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect.poll(() => menu.evaluate((element) => element.matches(":popover-open"))).toBe(false);
});

test("preview menu tracks its anchor when scrolling and stays within a narrow viewport", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(preview);
  await page.locator(".gprf-lifecycle").evaluate((control) => {
    document.body.style.minHeight = "2000px";
    (control.parentElement as HTMLElement).style.marginTop = "200px";
  });
  await page.locator("summary").click();
  const menu = page.locator(".gprf-lifecycle-menu");
  await page.evaluate(() => window.scrollBy(0, 100));
  await expect
    .poll(async () => {
      const anchor = await page.locator("summary").boundingBox();
      const box = await menu.boundingBox();
      return Math.round((box?.y ?? 0) - ((anchor?.y ?? 0) + (anchor?.height ?? 0)));
    })
    .toBe(8);
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(352);
});

test("pending counts do not move or rewrite the Needs review label", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=extension-lifecycle-control--preview-count-refresh&viewMode=story"
  );
  const label = page.locator(".gprf-summary-label");
  const count = page.locator(".gprf-summary-count");
  const initial = await label.boundingBox();
  await page.getByRole("button", { name: "Start refresh" }).click();
  await expect(count).toHaveCSS("visibility", "hidden");
  await expect(page.locator("summary")).toHaveAttribute(
    "aria-label",
    "Pull request state: Needs review"
  );
  expect((await label.boundingBox())!.x).toBe(initial!.x);
  await page.getByRole("button", { name: "Complete refresh" }).click();
  await expect(count).toHaveCSS("visibility", "visible");
  expect((await label.boundingBox())!.x).toBe(initial!.x);
  await expect(label).toHaveText("Needs review");
});

test("preview stays hidden until its queued toggle promotes the menu", async ({ page }) => {
  await page.goto(preview);
  const menu = page.locator(".gprf-lifecycle-menu");
  const verifyOpening = async () => {
    const beforePromotion = await page.locator(".gprf-lifecycle").evaluate((element) => {
      const control = element as HTMLDetailsElement;
      const popup = control.querySelector<HTMLElement>(".gprf-lifecycle-menu")!;
      // The native open mutation precedes the queued toggle event. Observe the
      // state before that handler can move the popup out of the list container.
      control.open = true;
      return { display: getComputedStyle(popup).display, topLayer: popup.matches(":popover-open") };
    });
    expect(beforePromotion).toEqual({ display: "none", topLayer: false });
    await expect(menu).toBeVisible();
    await expect
      .poll(() => menu.evaluate((element) => element.matches(":popover-open")))
      .toBe(true);
    await page.locator("summary").click();
    await expect(menu).toBeHidden();
  };
  await verifyOpening();
  await verifyOpening();
});
