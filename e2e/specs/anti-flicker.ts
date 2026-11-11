import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

// Count rendered frames, not merely the final state after navigation settles.
export function registerAntiFlickerSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: refreshed header replacements never paint native controls between filters`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "is:pr state:open" }));
    await browser.waitForControl();
    await browser.waitForElementCount("html.gprf-replacement-mounted", 1);
    await browser.click("[data-fixture-arm-visibility-probe]");
    async function replaceHeader(kind: "results" | "status"): Promise<void> {
      const before = Number(await browser.attribute("html", "data-gprf-probe-frames"));
      await browser.click(`[data-fixture-transition-${kind}]`);
      await browser.waitForNumericAttributeGreaterThan(
        "html",
        "data-gprf-probe-frames",
        before + 4
      );
      await browser.waitForElementCount(".gprf-lifecycle", 1);
      assert.equal(
        await browser.attribute("html", "data-gprf-native-visible-frames"),
        "0",
        "new native controls must be replaced before any sampled frame"
      );
      assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
      await browser.waitForElementCount(
        '[role="toolbar"][aria-label="Pull request filters"] button',
        2
      );
    }
    await replaceHeader("results");
    await replaceHeader("status");
    await replaceHeader("results");
    await replaceHeader("status");
  }, 90_000);

  test(`${context.browserName}: retained headers replace native controls without a visible frame or menu remount`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "is:pr state:open" }));
    await browser.waitForControl();
    await browser.waitForElementCount("html.gprf-replacement-mounted", 1);
    await browser.click("[data-fixture-arm-visibility-probe]");
    const before = Number(await browser.attribute("html", "data-gprf-probe-frames"));
    await browser.click("[data-fixture-replace-status-controls]");
    await browser.waitForNumericAttributeGreaterThan("html", "data-gprf-probe-frames", before + 4);
    await browser.waitForText(".gprf-summary-label", "Closed", true);
    await browser.waitForText(".gprf-summary-count", "747", true);
    assert.equal(await browser.attribute("html", "data-gprf-native-visible-frames"), "0");
    assert.equal(await browser.attribute(".gprf-saved-views", "data-fixture-identity"), "retained");
    assert.notEqual(
      await browser.cssValue(
        '[role="toolbar"][aria-label="Pull request filters"] button:first-child',
        "display"
      ),
      "none"
    );
    assert.equal(
      await browser.cssValue("[data-fixture-unrelated-results] h2", "clip-path"),
      "none"
    );
  }, 90_000);
}
