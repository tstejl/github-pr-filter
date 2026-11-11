import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { withExtensionSession } from "../harness/isolated-session";
import type { E2ETestContext, BrowserSession } from "../harness/contracts";

const HEADER = "main [data-fixture-preview-header]";
const TOOLBAR = '[role="toolbar"][aria-label="Pull request filters"]';
const CASES = [
  { query: "is:pr state:open", name: "Open", count: "10", slot: "status" },
  { query: "is:pr state:closed", name: "Closed", count: "747", slot: "status" },
  { query: "is:pr is:merged", name: "Merged", count: "700", slot: "results" },
  { query: "is:pr", name: "All", count: "757", slot: "results" },
  { query: "is:pr state:open draft:false", name: "Ready", count: "8", slot: "status" },
  {
    query: "is:pr is:merged gprf-no-match-928471",
    name: "Custom search",
    count: "0",
    slot: "results"
  }
] as const;

async function assertPlacement(
  browser: BrowserSession,
  expected: (typeof CASES)[number]
): Promise<void> {
  await browser.waitForElementCount(".gprf-saved-views", 1);
  await browser.waitForElementCount(
    `${HEADER} [data-fixture-preview-${expected.slot}] > .gprf-saved-views`,
    1
  );
  await browser.waitForText(".gprf-summary-label", expected.name, true);
  await browser.waitForText(".gprf-summary-count", expected.count, true);
  await browser.waitForElementCount(`${TOOLBAR} .gprf-saved-views`, 0);
  assert.deepEqual(await browser.text("[data-fixture-preview-title]"), ["Pull requests"]);
  assert.equal((await browser.text(TOOLBAR)).join("").replace(/\s+/gu, ""), "AuthorLabel");
  assert.equal(
    await browser.cssValue("[data-fixture-unrelated-results] > h2", "clip-path"),
    "none"
  );
  assert.notEqual(
    await browser.cssValue("[data-fixture-unrelated-results] > h2", "display"),
    "none"
  );
}

export function registerPreviewCompatibilitySpecs(context: E2ETestContext): void {
  for (const mode of [
    "preview-metadata",
    "preview-metadata-no-main",
    "preview-metadata-checkbox"
  ] as const) {
    test(`${context.browserName}: refreshed metadata supports ${mode} without moving the toolbar`, async () => {
      const browser = context.browser();
      await browser.open(context.fixture().urlFor({ mode, query: "is:pr state:open" }));
      await browser.waitForControl();
      await browser.waitForElementCount('[id$="-list-view-metadata"] > .gprf-saved-views', 1);
      await browser.waitForText(".gprf-summary-count", "12", true);
      assert.deepEqual(await browser.attributes('[id$="-list-view-metadata"] > a', "class"), [
        "gprf-native-status-hidden",
        "gprf-native-status-hidden"
      ]);
      await browser.waitForElementCount(
        '[aria-label="Pull request filters"] button.gprf-native-status-hidden',
        0
      );
      await browser.waitForElementCount(".gprf-saved-views", 1);
    }, 90_000);
  }
  for (const expected of CASES) {
    test(`${context.browserName}: refreshed ${expected.query} retains the native slot and count`, async () => {
      await context
        .browser()
        .open(context.fixture().urlFor({ mode: "preview", query: expected.query }));
      await context.browser().waitForControl();
      await assertPlacement(context.browser(), expected);
    }, 90_000);
  }
  test(`${context.browserName}: late result hydration updates one mounted view`, async () => {
    const browser = context.browser();
    await browser.open(
      context.fixture().urlFor({ mode: "preview-hydration", query: "is:pr is:merged" })
    );
    await browser.waitForControl();
    await browser.waitForText(".gprf-summary-count", "700", true);
    await assertPlacement(browser, CASES[2]);
  }, 90_000);
  test(`${context.browserName}: delayed interactive startup leaves native metadata usable until mounting`, async () => {
    await withExtensionSession(
      context.browserName,
      { interactiveDelayMs: 1000 },
      async (browser) => {
        await browser.open(
          context.fixture().urlFor({ mode: "preview-metadata-no-main", query: "is:pr state:open" })
        );
        await browser.waitForNumericAttributeGreaterThan(
          "html",
          "data-gprf-native-visible-frames",
          1
        );
        await browser.waitForControl();
        await browser.waitForElementCount('[id$="-list-view-metadata"] > .gprf-saved-views', 1);
        assert.equal(
          await browser.cssValue('[id$="-list-view-metadata"] > a:first-of-type', "display"),
          "none"
        );
      }
    );
  }, 90_000);
  for (const count of ["0", "700"]) {
    test(`${context.browserName}: unchanged refreshed count ${count} returns only after list completion`, async () => {
      const browser = context.browser();
      const query = count === "0" ? CASES[5].query : CASES[2].query;
      await browser.open(context.fixture().urlFor({ mode: "preview", query }));
      await browser.waitForControl();
      await browser.waitForText(".gprf-summary-count", count, true);
      await browser.click("[data-fixture-reuse-count]");
      await browser.waitForElementCount(".gprf-summary-count[hidden]", 1);
      await browser.waitForElementCount(
        '[data-listview-component="items-list"][aria-busy="false"]',
        1
      );
      await browser.waitForElementCount(".gprf-summary-count[hidden]", 0);
      await browser.waitForText(".gprf-summary-count", count, true);
    }, 90_000);
  }
  test(`${context.browserName}: unsubmitted typing leaves committed saved-view links and selection unchanged`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: null }));
    await browser.waitForControl();
    const links = await browser.attributes(".gprf-saved-option", "href");
    const selection = await browser.text(".gprf-summary-label");
    const frames = Number(await browser.attribute("html", "data-gprf-probe-frames"));
    await browser.setUnsubmittedSearchQuery("is:pr state:closed draft:true");
    await browser.appendUnrelatedDomMutation();
    await browser.waitForNumericAttributeGreaterThan("html", "data-gprf-probe-frames", frames + 3);
    assert.deepEqual(await browser.attributes(".gprf-saved-option", "href"), links);
    assert.deepEqual(await browser.text(".gprf-summary-label"), selection);
  }, 90_000);
}
