import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { withExtensionSession } from "../harness/isolated-session";
import type { E2ETestContext } from "../harness/contracts";

const PREVIEW_HEADER = "main [data-fixture-preview-header]";
const PREVIEW_CONTROL = `${PREVIEW_HEADER} .gprf-lifecycle--preview`;
const PREVIEW_STATUS = `${PREVIEW_HEADER} [data-fixture-preview-status]`;
const PREVIEW_RESULTS = `${PREVIEW_HEADER} [data-fixture-preview-results]`;
const PREVIEW_TOOLBAR = '[role="toolbar"][aria-label="Pull request filters"]';

const PREVIEW_CASES = [
  { query: "is:pr is:open", label: "Open", count: "10", slot: "status" },
  { query: "is:pr is:closed", label: "Closed", count: "747", slot: "status" },
  { query: "is:pr is:merged", label: "Merged", count: "700", slot: "results" },
  { query: "is:pr", label: "All", count: "757", slot: "results" },
  {
    query: "is:pr is:open draft:false",
    label: "Ready",
    count: "8",
    slot: "status"
  },
  {
    query: "is:pr is:merged gprf-no-match-928471",
    label: "Merged",
    count: "0",
    slot: "results"
  }
] as const;

async function assertPreviewPlacement(
  browser: ReturnType<E2ETestContext["browser"]>,
  expected: (typeof PREVIEW_CASES)[number]
): Promise<void> {
  await browser.waitForElementCount(PREVIEW_CONTROL, 1);
  await browser.waitForElementCount(".gprf-lifecycle", 1);
  await browser.waitForElementCount(`${PREVIEW_TOOLBAR} .gprf-lifecycle`, 0);
  await browser.waitForElementCount(
    expected.slot === "status"
      ? `${PREVIEW_STATUS} > .gprf-lifecycle`
      : `${PREVIEW_RESULTS} > .gprf-lifecycle`,
    1
  );

  assert.deepEqual(await browser.text(".gprf-summary-label"), [expected.label]);
  assert.deepEqual(await browser.text(".gprf-summary-count"), [expected.count]);
  assert.deepEqual(await browser.text("[data-fixture-preview-title]"), ["Pull requests"]);
  assert.equal((await browser.text(PREVIEW_TOOLBAR)).join("").replace(/\s+/gu, ""), "AuthorLabel");
  assert.deepEqual(
    await browser.attributes(`${PREVIEW_STATUS} > button`, "class"),
    expected.slot === "status" ? ["gprf-native-status-hidden", "gprf-native-status-hidden"] : []
  );
  assert.deepEqual(
    await browser.attributes(`${PREVIEW_RESULTS} > h2`, "class"),
    expected.slot === "results" ? ["gprf-native-results-hidden"] : []
  );
  assert.equal(await browser.attribute("[data-fixture-unrelated-results] > h2", "class"), null);
}

export function registerPreviewCompatibilitySpecs(context: E2ETestContext): void {
  for (const mode of [
    "preview-captured",
    "preview-captured-no-main",
    "preview-captured-checkbox"
  ] as const) {
    test(`${context.browserName}: captured preview header mounts with ${mode}`, async () => {
      const browser = context.browser();
      await browser.open(context.fixture().urlFor({ mode, query: "is:pr state:open" }));
      await browser.waitForControl();
      assert.deepEqual(
        await browser.text('[id$="-list-view-metadata"] > .gprf-lifecycle .gprf-summary-label'),
        ["Open"]
      );
      assert.deepEqual(await browser.text(".gprf-summary-count"), ["25"]);
      assert.deepEqual(
        await browser
          .attributes('[id$="-list-view-metadata"] > a', "class")
          .then((values) => values.map((value) => value?.includes("gprf-native-status-hidden"))),
        [true, true]
      );
      await browser.waitForElementCount(".gprf-lifecycle", 1);
      await browser.waitForElementCount(".gprf-lifecycle--standalone", 0);
      assert.deepEqual(
        await browser
          .attributes('[aria-label="Pull request filters"] button', "class")
          .then((values) => values.map((value) => value?.includes("gprf-native-status-hidden"))),
        Array(7).fill(false)
      );
      const starts = Number(
        (await browser.attribute("html", "data-gprf-menu-animation-starts")) ?? "0"
      );
      await browser.click(".gprf-lifecycle-summary");
      await browser.wait(350);
      assert.equal(
        Number(await browser.attribute("html", "data-gprf-menu-animation-starts")),
        starts + 1
      );
      await browser.waitForElementCount('[id$="-list-view-metadata"] > .gprf-lifecycle[open]', 1);
      await browser.waitForElementCount(".gprf-lifecycle-menu:popover-open", 1);
      assert.equal(await browser.attribute("html", "data-gprf-summary-expansion-variants"), "1");
      await browser.click('.gprf-lifecycle-option[data-lifecycle="closed"]');
      await browser.waitForText(".gprf-summary-label", "Closed", true);
      assert.deepEqual(await browser.text(".gprf-summary-count"), [
        mode === "preview-captured-checkbox" ? "2,131" : "2,126"
      ]);
    }, 90_000);
  }

  test(`${context.browserName}: captured preview stays hidden during delayed startup`, async () => {
    await withExtensionSession(
      context.browserName,
      { interactiveDelayMs: 2500 },
      async (browser) => {
        await browser.open(
          context.fixture().urlFor({ mode: "preview-captured-no-main", query: "is:pr state:open" })
        );
        await browser.waitForControl();
        assert.ok(Number(await browser.attribute("html", "data-gprf-pre-mount-frames")) > 0);
        assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
        assert.deepEqual(
          await browser.text('[id$="-list-view-metadata"] > .gprf-lifecycle .gprf-summary-count'),
          ["25"]
        );
      }
    );
  }, 90_000);

  for (const expected of PREVIEW_CASES) {
    test(`${context.browserName}: preview replaces ${expected.query} in place`, async () => {
      await context
        .browser()
        .open(context.fixture().urlFor({ mode: "preview", query: expected.query }));
      await context.browser().waitForControl();
      await assertPreviewPlacement(context.browser(), expected);
    }, 90_000);
  }

  test(`${context.browserName}: preview results hydrate late without a duplicate or floating control`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "preview-hydration", query: "is:pr is:merged" }));
    await browser.waitForElementCount(PREVIEW_CONTROL, 1);
    await browser.waitForElementCount(".gprf-lifecycle--standalone", 0);
    await browser.waitForText("[data-fixture-result-heading]", "700 results", true);
    await browser.waitForElementCount(PREVIEW_CONTROL, 1);
    await browser.waitForElementCount(".gprf-lifecycle--standalone", 0);
    await browser.waitForElementCount(".gprf-lifecycle", 1);

    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Merged"]);
    await browser.waitForText(".gprf-summary-count", "700", true);
    assert.equal(
      await browser.attribute(`${PREVIEW_RESULTS} > h2`, "class"),
      "gprf-native-results-hidden"
    );
    assert.equal(await browser.attribute("[data-fixture-unrelated-results] > h2", "class"), null);
  }, 90_000);

  test(`${context.browserName}: preview transitions keep placement and preserve an extra filter`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "preview", query: "is:pr is:open" }));
    await browser.waitForControl();
    await assertPreviewPlacement(browser, PREVIEW_CASES[0]);

    await browser.search("is:pr is:open label:bug");
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q") === "is:pr is:open label:bug"
    );
    await browser.waitForControl();
    await assertPreviewPlacement(browser, PREVIEW_CASES[0]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click('.gprf-lifecycle-option[data-lifecycle="merged"]');
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q")?.includes("is:merged") === true
    );
    await browser.waitForControl();
    await assertPreviewPlacement(browser, PREVIEW_CASES[2]);
    assert.ok(new URL(await browser.url()).searchParams.get("q")?.includes("label:bug"));

    await browser.click(".gprf-lifecycle-summary");
    await browser.click('.gprf-lifecycle-option[data-lifecycle="open"]');
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q")?.includes("is:open") === true
    );
    await browser.waitForControl();
    await assertPreviewPlacement(browser, PREVIEW_CASES[0]);

    await browser.click(".gprf-lifecycle-summary");
    await browser.click('.gprf-lifecycle-option[data-lifecycle="merged"]');
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q")?.includes("is:merged") === true
    );
    await browser.waitForControl();
    await assertPreviewPlacement(browser, PREVIEW_CASES[2]);
    assert.ok(new URL(await browser.url()).searchParams.get("q")?.includes("label:bug"));
  }, 90_000);

  for (const query of ["is:pr is:open", "is:pr is:merged"]) {
    test(`${context.browserName}: preview ${query} stays hidden before interactive mount`, async () => {
      await withExtensionSession(
        context.browserName,
        { interactiveDelayMs: 2500 },
        async (browser) => {
          await browser.open(context.fixture().urlFor({ mode: "preview", query }));
          await browser.waitForControl();
          assert.ok(Number(await browser.attribute("html", "data-gprf-pre-mount-frames")) > 0);
          assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
          await browser.waitForElementCount(PREVIEW_CONTROL, 1);
        }
      );
    }, 90_000);
  }

  test(`${context.browserName}: preview count waits for native content after an in-page query change`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "is:pr is:merged" }));
    await browser.waitForControl();
    await browser.replaceUrlQuery("is:pr");
    await browser.waitForText(".gprf-summary-label", "All", true);
    await browser.waitForElementCount(".gprf-summary-count--pending", 1);
    await browser.appendUnrelatedDomMutation();
    await browser.wait(150);
    await browser.waitForElementCount(".gprf-summary-count--pending", 1);
    await browser.click("[data-fixture-update-results]");
    await browser.waitForText(".gprf-summary-count", "757", true);
    await browser.waitForElementCount(PREVIEW_CONTROL, 1);
    assert.equal(await browser.mutationCount(PREVIEW_CONTROL, 250), 0);
  }, 90_000);

  test(`${context.browserName}: preview replaces native header subtrees during in-page navigation`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "is:pr is:open" }));
    await browser.waitForControl();
    await browser.click("[data-fixture-transition-results]");
    await browser.waitForText(".gprf-summary-label", "Merged", true);
    await browser.waitForElementCount(`${PREVIEW_RESULTS} > .gprf-lifecycle`, 1);
    await browser.waitForElementCount(".gprf-lifecycle--standalone", 0);
    await browser.waitForText(".gprf-summary-count", "700", true);
    await assertPreviewPlacement(browser, PREVIEW_CASES[2]);
    await browser.click("[data-fixture-transition-status]");
    await browser.waitForText(".gprf-summary-label", "Open", true);
    await assertPreviewPlacement(browser, PREVIEW_CASES[0]);
    assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), null);
  }, 90_000);

  test(`${context.browserName}: classic headers retain their original slot and styling contract`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.waitForElementCount(".table-list-header-toggle.states > .gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-lifecycle--preview", 0);
    await browser.waitForElementCount(`${PREVIEW_TOOLBAR} .gprf-lifecycle`, 0);
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["3"]);
    assert.equal(
      await browser.attribute(".table-list-header-toggle.states > a:first-child", "class"),
      "btn-link selected gprf-native-status-hidden"
    );
  }, 90_000);
}
