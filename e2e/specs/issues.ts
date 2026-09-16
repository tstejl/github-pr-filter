import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

const METADATA = '[id$="-list-view-metadata"]';
const STATUS_LIST = `${METADATA} ul.list-style-none`;

async function assertNativeIssuesUi(browser: ReturnType<E2ETestContext["browser"]>): Promise<void> {
  await browser.waitForElementCount(`${STATUS_LIST} a`, 2);
  await browser.waitForElementCount(`${STATUS_LIST} a.gprf-native-status-hidden`, 0);
  await browser.waitForElementCount(".gprf-lifecycle", 0);
  const openTab = `${STATUS_LIST} a[data-open-closed-tab="open"]`;
  assert.notEqual(await browser.cssValue(openTab, "display"), "none");
  assert.notEqual(await browser.cssValue(openTab, "visibility"), "hidden");
  const labels = await browser.text(`${STATUS_LIST} a`);
  assert.match(labels[0] ?? "", /^Open/u);
  assert.match(labels[1] ?? "", /^Closed/u);
  assert.deepEqual(await browser.text(`${STATUS_LIST} a span[aria-hidden="true"]`), [
    "18,472",
    "7,231"
  ]);
  const classes = (await browser.attribute("html", "class")) ?? "";
  assert.equal(classes.includes("gprf-replacement-pending"), false);
  assert.equal(classes.includes("gprf-replacement-mounted"), false);
}

export function registerIssueSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: Issues keep native status and actions untouched`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ kind: "issues" }));
    await assertNativeIssuesUi(browser);
    await browser.waitForElementCount(`${METADATA} [role="toolbar"][aria-label="Actions"]`, 1);
  }, 90_000);

  test(`${context.browserName}: SPA PR to Issues to PR clears and remounts the PR control`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ kind: "issues" }));
    await assertNativeIssuesUi(browser);

    await browser.navigateRepository("/octocat/hello-world/pulls");
    await browser.waitForControl();
    await browser.waitForElementCount(
      ".table-list-header-toggle.states > a.gprf-native-status-hidden",
      2
    );

    await browser.navigateRepository("/octocat/hello-world/issues");
    await assertNativeIssuesUi(browser);

    await browser.navigateRepository("/octocat/hello-world/pulls");
    await browser.waitForControl();
    await browser.waitForElementCount(
      ".table-list-header-toggle.states > a.gprf-native-status-hidden",
      2
    );
  }, 90_000);
}
