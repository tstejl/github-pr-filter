import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

export function registerTurboDomSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: Turbo target changes keep exactly one lifecycle control`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.waitForElementCount(".table-list-header-toggle.states > .gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-lifecycle", 1);

    const probeFramesBeforeReplacement = Number(
      (await browser.attribute("html", "data-gprf-probe-frames")) ?? "0"
    );
    assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
    await browser.replaceNativeStatusHeaderWithoutSignal();
    await browser.waitForElementCount(".table-list-header-toggle.states > .gprf-lifecycle", 1);
    await browser.waitForNumericAttributeGreaterThan(
      "html",
      "data-gprf-probe-frames",
      probeFramesBeforeReplacement
    );
    assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);

    await browser.duplicateLifecycleControl();
    await browser.waitForElementCount(".table-list-header-toggle.states > .gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-lifecycle", 1);

    await browser.removeLifecycleControl();
    await browser.waitForElementCount(".table-list-header-toggle.states > .gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-native-status-hidden", 2);

    await browser.setNativeStatusHeader(false);
    await browser.waitForElementCount(".gprf-lifecycle--standalone", 1);
    await browser.waitForElementCount(".gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-native-status-hidden", 0);

    await browser.setNativeStatusHeader(true);
    await browser.waitForElementCount(".table-list-header-toggle.states > .gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-lifecycle--standalone", 0);
    await browser.waitForElementCount(".gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-native-status-hidden", 2);
  }, 90_000);

  test(`${context.browserName}: repository Turbo navigation discards the previous repository editor`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.click(".gprf-lifecycle-summary");
    await browser.clickReplacing(".gprf-configure-action");
    await browser.clickReplacing(
      '.gprf-editor-row[data-lifecycle="draft"] .gprf-editor-visibility'
    );
    assert.equal(
      await browser.attribute(
        '.gprf-editor-row[data-lifecycle="draft"] .gprf-editor-visibility',
        "aria-label"
      ),
      "Show Draft"
    );

    await browser.navigateRepository("/octocat/another-repository/pulls");
    await browser.waitForElementCount(".gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-lifecycle--configuring", 0);
    await browser.click(".gprf-lifecycle-summary");
    await browser.clickReplacing(".gprf-configure-action");
    assert.equal(
      await browser.attribute(
        '.gprf-editor-row[data-lifecycle="draft"] .gprf-editor-visibility',
        "aria-label"
      ),
      "Hide Draft"
    );
  }, 90_000);

  test(`${context.browserName}: missing mount targets stay hidden and recover`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    assert.ok(
      ((await browser.attribute("html", "class")) || "").includes("gprf-replacement-mounted")
    );
    assert.equal(
      ((await browser.attribute("html", "class")) || "").includes("gprf-replacement-pending"),
      false
    );

    const preMountFramesBeforeMissingTargets = Number(
      (await browser.attribute("html", "data-gprf-pre-mount-frames")) ?? "0"
    );
    await browser.setEligibleMountTargets(false);
    await browser.waitForElementCount(".gprf-lifecycle", 0);
    await browser.waitForElementCount("html.gprf-replacement-pending", 1);
    await browser.waitForNumericAttributeGreaterThan(
      "html",
      "data-gprf-pre-mount-frames",
      preMountFramesBeforeMissingTargets
    );
    const waitingClasses = (await browser.attribute("html", "class")) || "";
    assert.equal(waitingClasses.includes("gprf-replacement-mounted"), false);
    assert.ok(waitingClasses.includes("gprf-replacement-pending"));
    assert.equal(await browser.cssValue(".gprf-waiting-native > a:first-child", "display"), "none");
    assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);

    await browser.setEligibleMountTargets(true);
    await browser.waitForElementCount(".gprf-lifecycle", 1);
    const recoveredClasses = (await browser.attribute("html", "class")) || "";
    assert.ok(recoveredClasses.includes("gprf-replacement-mounted"));
    assert.equal(recoveredClasses.includes("gprf-replacement-pending"), false);
  }, 90_000);

  test(`${context.browserName}: global pull request pages remain untouched`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();
    const globalUrl = new URL(fixture.url);
    globalUrl.pathname = "/pulls";
    await browser.open(globalUrl.href);
    assert.deepEqual(await browser.text(".gprf-lifecycle-summary"), []);
    assert.equal(
      ((await browser.attribute("html", "class")) || "").includes("gprf-replacement-pending"),
      false
    );
    assert.equal(
      ((await browser.attribute("html", "class")) || "").includes("gprf-replacement-mounted"),
      false
    );
    assert.notEqual(
      await browser.cssValue(".table-list-header-toggle.states > a:first-child", "display"),
      "none"
    );
    const nativeClasses =
      (await browser.attribute(".table-list-header-toggle.states > a:first-child", "class")) ?? "";
    assert.equal(nativeClasses.split(/\s+/).includes("gprf-native-status-hidden"), false);
  }, 90_000);
}
