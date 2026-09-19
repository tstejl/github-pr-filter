import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

const OPTION_SELECTOR = ".gprf-lifecycle-option";

export function registerCustomizationSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: repository customization persists, cancels, resets, and synchronizes`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();
    const cleanUrl = new URL(fixture.url);
    cleanUrl.search = "";

    await browser.open(cleanUrl.href);
    await browser.waitForControl();

    await browser.openNewTab(cleanUrl.href);
    await browser.waitForControl();
    await browser.switchToTab(0);

    await browser.click(".gprf-lifecycle-summary");
    await browser.clickReplacing(".gprf-configure-action");
    await browser.clickReplacing(
      '.gprf-editor-row[data-lifecycle="draft"] .gprf-editor-visibility'
    );
    await browser.clickReplacing(".gprf-save-action");
    assert.equal((await browser.text(".gprf-option-label")).includes("Draft"), false);
    assert.ok(
      (await browser.attributes(OPTION_SELECTOR, "data-turbo-frame")).every(
        (frame) => frame === "repo-content"
      )
    );

    await browser.switchToTab(1);
    await browser.waitForText(".gprf-option-label", "Draft", false);
    await browser.switchToTab(0);

    await browser.open(cleanUrl.href);
    await browser.waitForControl();
    await browser.click(".gprf-lifecycle-summary");
    assert.equal((await browser.text(".gprf-option-label")).includes("Draft"), false);

    await browser.clickReplacing(".gprf-configure-action");
    await browser.clickReplacing(
      '.gprf-editor-row[data-lifecycle="draft"] .gprf-editor-visibility'
    );
    await browser.clickReplacing(".gprf-cancel-action");
    assert.equal((await browser.text(".gprf-option-label")).includes("Draft"), false);

    await browser.clickReplacing(".gprf-configure-action");
    await browser.clickReplacing(".gprf-reset-action");
    assert.equal((await browser.text(".gprf-option-label")).includes("Draft"), true);
    assert.ok(
      (await browser.attributes(OPTION_SELECTOR, "data-turbo-frame")).every(
        (frame) => frame === "repo-content"
      )
    );

    await browser.open(cleanUrl.href);
    await browser.waitForControl();
    await browser.click(".gprf-lifecycle-summary");
    assert.equal((await browser.text(".gprf-option-label")).includes("Draft"), true);

    const otherRepositoryUrl = new URL(cleanUrl);
    otherRepositoryUrl.pathname = "/octocat/another-repository/pulls";
    await browser.open(otherRepositoryUrl.href);
    await browser.waitForControl();
    await browser.click(".gprf-lifecycle-summary");
    assert.equal((await browser.text(".gprf-option-label")).includes("Draft"), true);
  }, 90_000);
}
