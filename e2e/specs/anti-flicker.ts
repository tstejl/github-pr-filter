import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";
import { withExtensionSession } from "../harness/isolated-session";

function preMountFrames(value: string | null): number {
  return Number(value ?? "0");
}

export function registerAntiFlickerSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: delayed content never reveals GitHub before mounting`, async () => {
    const fixture = context.fixture();

    await withExtensionSession(
      context.browserName,
      { interactiveDelayMs: 2_500 },
      async (browser) => {
        await browser.open(fixture.url);
        await browser.waitForElementCount("html.gprf-replacement-pending", 1);
        assert.equal(
          await browser.cssValue(".table-list-header-toggle.states > a:first-child", "display"),
          "none"
        );

        await browser.waitForControl();
        assert.ok(
          preMountFrames(await browser.attribute("html", "data-gprf-pre-mount-frames")) > 0
        );
        assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
        assert.equal(
          await browser.cssValue(".table-list-header-toggle.states > a:first-child", "display"),
          "none"
        );
        const classes = (await browser.attribute("html", "class")) || "";
        assert.ok(classes.includes("gprf-replacement-mounted"));
        assert.equal(classes.includes("gprf-replacement-pending"), false);
      }
    );
  }, 90_000);

  test(`${context.browserName}: partial GitHub hydration stays hidden until mounting`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "partial-status-hydration" }));
    await browser.waitForControl();

    assert.ok(preMountFrames(await browser.attribute("html", "data-gprf-pre-mount-frames")) > 0);
    assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
    const classes = (await browser.attribute("html", "class")) || "";
    assert.ok(classes.includes("gprf-replacement-mounted"));
    assert.equal(classes.includes("gprf-replacement-pending"), false);
  }, 90_000);

  test(`${context.browserName}: bootstrap-only failure keeps GitHub native controls hidden`, async () => {
    const fixture = context.fixture();

    await withExtensionSession(
      context.browserName,
      { contentMode: "bootstrap-only" },
      async (browser) => {
        await browser.open(fixture.url);
        await browser.waitForElementCount("html.gprf-replacement-pending", 1);
        await browser.wait(2_500);

        const classes = (await browser.attribute("html", "class")) || "";
        assert.equal(classes.includes("gprf-replacement-mounted"), false);
        assert.ok(classes.includes("gprf-replacement-pending"));
        assert.ok(
          preMountFrames(await browser.attribute("html", "data-gprf-pre-mount-frames")) > 0
        );
        assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
        assert.equal(
          await browser.cssValue(".table-list-header-toggle.states > a:first-child", "display"),
          "none"
        );
      }
    );
  }, 90_000);
}
