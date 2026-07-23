import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

const OPTION_SELECTOR = ".gprf-lifecycle-option";

export function registerQueryNavigationSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: initial render matches GitHub's menu and count contract`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.mutationCount(".gprf-lifecycle", 250);
    assert.equal(await browser.mutationCount(".gprf-lifecycle", 250), 0);
    assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);

    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["3"]);
    assert.equal(
      await browser.attribute(".gprf-lifecycle-summary", "aria-label"),
      "3 pull requests: Open"
    );
    assert.deepEqual(await browser.text(".gprf-lifecycle-summary > .gprf-lifecycle-icon"), []);
    const nativeClasses = await browser.attribute(
      ".table-list-header-toggle.states > a:first-child",
      "class"
    );
    assert.ok(nativeClasses?.split(/\s+/).includes("gprf-native-status-hidden"));
    assert.ok(
      (await browser.attributes(OPTION_SELECTOR, "data-turbo-frame")).every(
        (frame) => frame === "repo-content"
      )
    );

    await browser.click(".gprf-lifecycle-summary");
    assert.notEqual(await browser.cssValue(".gprf-summary-count", "display"), "none");
    assert.deepEqual(await browser.text(".gprf-option-label"), [
      "Needs review",
      "Open",
      "Ready",
      "Draft",
      "Closed",
      "Merged",
      "Closed without merging",
      "All"
    ]);
    const menuIconPaths = await browser.attributes(
      ".gprf-lifecycle-option > .gprf-lifecycle-icon:first-child path",
      "d"
    );
    assert.equal(menuIconPaths.length, 8);
    assert.equal(new Set(menuIconPaths).size, 8);
  }, 90_000);

  test(`${context.browserName}: preset transitions preserve orthogonal query filters`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="draft"]`);
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q")?.includes("draft:true") === true
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Draft"]);
    assert.equal(
      await browser.attribute(`${OPTION_SELECTOR}[data-lifecycle="draft"]`, "aria-checked"),
      "true"
    );

    await browser.search("state:open label:bug");
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q") === "state:open label:bug"
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="ready"]`);
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q") === "label:bug is:open draft:false"
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Ready"]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="needs_review"]`);
    await browser.waitForUrl(
      (url) =>
        new URL(url).searchParams.get("q") ===
        "label:bug is:open draft:false -review:approved -review:changes_requested"
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Needs review"]);

    await browser.search("is:pr is:closed draft:true");
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q") === "is:pr is:closed draft:true"
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Custom"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["2"]);

    await browser.click(".gprf-lifecycle-summary");
    assert.equal(
      await browser.attribute(`${OPTION_SELECTOR}[data-lifecycle="custom"]`, "aria-checked"),
      "true"
    );
    assert.deepEqual((await browser.text(".gprf-option-label")).slice(0, 2), [
      "Custom query",
      "Needs review"
    ]);
    assert.equal((await browser.text(".gprf-option-label")).at(-1), "All");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="closed_unmerged"]`);
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q")?.includes("is:unmerged") === true
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Closed without merging"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["2"]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="merged"]`);
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q")?.includes("is:merged") === true
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Merged"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["4"]);
  }, 90_000);

  test(`${context.browserName}: All and partial Custom queries retain accurate counts`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.search("is:pr is:open");
    await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === "is:pr is:open");
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="all"]`);
    await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === "is:pr");
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["All"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["5"]);

    await browser.search("is:pr is:unmerged");
    await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === "is:pr is:unmerged");
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Custom"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["4"]);

    await browser.search("is:pr draft:true");
    await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === "is:pr draft:true");
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Custom"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["5"]);

    await browser.search("is:pr -review:approved -review:changes_requested");
    await browser.waitForUrl(
      (url) =>
        new URL(url).searchParams.get("q") === "is:pr -review:approved -review:changes_requested"
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["All"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["5"]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="open"]`);
    await browser.waitForUrl(
      (url) =>
        new URL(url).searchParams.get("q") ===
        "is:pr -review:approved -review:changes_requested is:open"
    );
    await browser.waitForControl();
  }, 90_000);

  test(`${context.browserName}: unsafe Custom queries fail closed and clear-search recovers`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    const correlatedQuery = "(is:open AND label:bug) OR label:docs";
    await browser.search(correlatedQuery);
    await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === correlatedQuery);
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Custom"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), [""]);
    await browser.click(".gprf-lifecycle-summary");
    assert.ok(
      (
        await browser.attributes(
          `${OPTION_SELECTOR}:not([data-lifecycle="custom"])`,
          "aria-disabled"
        )
      ).every((disabled) => disabled === "true")
    );

    await browser.click(".js-clear-search");
    await browser.waitForUrl((url) => !new URL(url).searchParams.has("q"));
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="draft"]`);
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q")?.includes("draft:true") === true
    );
    await browser.waitForControl();

    const cleanUrl = new URL(await browser.url());
    cleanUrl.search = "";
    await browser.open(cleanUrl.href);
    await browser.waitForControl();
    assert.equal(new URL(await browser.url()).searchParams.has("q"), false);
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["3"]);
  }, 90_000);
}
