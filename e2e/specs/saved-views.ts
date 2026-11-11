import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { createDefaultViewLayout, visibleViewEntries } from "../../src/saved-views";
import type { BrowserSession, E2ETestContext } from "../harness/contracts";
import { withExtensionSession } from "../harness/isolated-session";

const SUMMARY = ".gprf-lifecycle-summary";
const MENU_LINK = ".gprf-saved-option";

function repositoryUrl(context: E2ETestContext, repository: string, query: string): string {
  return context
    .fixture()
    .urlFor({ mode: "preview", query })
    .replace("/octocat/hello-world/pulls", `/octocat/${repository}/pulls`);
}

async function openPreview(
  browser: BrowserSession,
  context: E2ETestContext,
  repository: string,
  query: string
): Promise<void> {
  await browser.open(repositoryUrl(context, repository, query));
  await browser.waitForControl();
}

async function ensureMenuOpen(browser: BrowserSession): Promise<void> {
  if ((await browser.attribute(".gprf-lifecycle", "open")) === null) await browser.click(SUMMARY);
}

async function openCustomize(browser: BrowserSession): Promise<void> {
  await ensureMenuOpen(browser);
  await browser.click(".gprf-customize-views");
  await browser.waitForElementCount('.gprf-saved-menu[data-mode="customize"]', 1);
  await browser.waitForElementCount(".gprf-views-editor", 1);
}

async function saveCurrentView(
  browser: BrowserSession,
  name: string,
  currentQuery: string
): Promise<void> {
  await ensureMenuOpen(browser);
  await browser.click(".gprf-save-current");
  await browser.waitForTabs(1);
  await browser.waitForElementCount('.gprf-saved-menu[data-mode="form"]', 1);
  await browser.fill('[name="name"]', name);
  // Keep the query field untouched. Its saved link verifies the current query prefilled the form.
  assert.equal(new URL(await browser.url()).searchParams.get("q"), currentQuery);
  await browser.click(".gprf-save-views");
  await browser.waitForElementCount(".gprf-views-editor", 0);
  await browser.waitForTabs(1);
  await browser.waitForText(SUMMARY, name, true);
  const links = await browser.attributes(MENU_LINK, "href");
  assert.ok(
    links.some(
      (href) => new URL(href ?? "https://github.com").searchParams.get("q") === currentQuery
    ),
    "the saved view must keep the complete current query"
  );
}

export function registerSavedViewsSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: full view descriptions preserve focus and dismiss before the picker`, async () => {
    const browser = context.browser();
    const description = "Open and awaiting review, not authored by me";
    const row = `${MENU_LINK}[data-view-id="builtin-needs_review"]`;
    const tooltip = ".gprf-view-description-tooltip";
    await openPreview(browser, context, "description-tooltip", "is:pr state:open");
    await openCustomize(browser);
    await browser.click('[data-edit-id="builtin-needs_review"]');
    await browser.click(".gprf-view-description > summary");
    await browser.fill('[name="description"]', description);
    await browser.click(".gprf-save-views");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    await browser.press(SUMMARY, "ArrowDown");
    await browser.waitForElementCount(`${tooltip}:popover-open`, 1);
    assert.deepEqual(await browser.text(tooltip), [description]);
    assert.equal(await browser.cssValue(row, "height"), "44px");
    assert.equal(
      await browser.attribute(row, "aria-describedby"),
      await browser.attribute(tooltip, "id")
    );
    await browser.press(row, "Escape");
    await browser.waitForElementCount(`${tooltip}:popover-open`, 0);
    await browser.waitForElementCount(".gprf-saved-menu:popover-open", 1);
    await browser.waitForElementCount(`${row}:focus`, 1);
    assert.equal(
      await browser.attribute(row, "aria-describedby"),
      await browser.attribute(`${row} .gprf-view-copy > span`, "id")
    );
    await browser.press(row, "Escape");
    await browser.waitForElementCount(".gprf-saved-menu:popover-open", 0);
    await browser.waitForElementCount(`${SUMMARY}:focus`, 1);
  }, 90_000);

  test(`${context.browserName}: saved view menu keeps exact links, selected state, and counts`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "type:pr state:open" }));
    await browser.waitForControl();

    assert.equal(
      await browser.attribute(SUMMARY, "aria-label"),
      "Pull request view: Open, 10 results"
    );
    assert.equal(
      await browser.attribute(`${MENU_LINK}[aria-checked="true"]`, "data-view-id"),
      "builtin-open"
    );
    await ensureMenuOpen(browser);

    const links = await browser.attributes(MENU_LINK, "href");
    const expected = createDefaultViewLayout().entries.flatMap((entry) =>
      entry.type === "view" && entry.visible
        ? (() => {
            const target = new URL("https://github.com/octocat/hello-world/pulls");
            target.searchParams.set("q", entry.query);
            return [target.href];
          })()
        : []
    );
    assert.deepEqual(links, expected);
    assert.equal(
      (await browser.attributes(".gprf-view-separator", "role")).every(
        (role) => role === "separator"
      ),
      true
    );
    await browser.waitForTabs(1);
    await browser.waitForElementCount(".gprf-saved-menu[data-mode]", 0);
  }, 90_000);

  test(`${context.browserName}: saved view links replace the full query and retain raw terms`, async () => {
    const browser = context.browser();
    const query = 'is:pr label:"needs review" sort:updated-desc';
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "is:pr is:open" }));
    await browser.waitForControl();
    await ensureMenuOpen(browser);
    const openLink = await browser.attribute(`${MENU_LINK}[data-view-id="builtin-open"]`, "href");
    assert.ok(openLink);
    assert.equal(new URL(openLink).searchParams.get("q"), "is:pr state:open");
    assert.equal(new URL(openLink).searchParams.has("milestone"), false);

    await browser.open(context.fixture().urlFor({ mode: "preview", query }));
    await browser.waitForControl();
    assert.equal(new URL(await browser.url()).searchParams.get("q"), query);
  }, 90_000);

  test(`${context.browserName}: an empty new view closes without a save`, async () => {
    const browser = context.browser();
    const repository = `blank-${crypto.randomUUID().slice(0, 8)}`;
    await openPreview(browser, context, repository, "is:pr state:open");
    await openCustomize(browser);
    await browser.click(".gprf-add-view");
    await browser.waitForElementCount('.gprf-saved-menu[data-mode="form"]', 1);
    await browser.waitForElementCount(".gprf-save-views:not(:disabled)", 1);
    await browser.click(".gprf-view-back");
    await browser.waitForElementCount('.gprf-saved-menu[data-mode="customize"]', 1);
    await browser.click(".gprf-view-editor-footer .gprf-view-actions button:first-child");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    await browser.waitForTabs(1);

    await openCustomize(browser);
    const savedViewIds = await browser.attributes(".gprf-edit-view", "data-edit-id");
    const defaultViewCount = createDefaultViewLayout().entries.filter(
      (entry) => entry.type === "view"
    ).length;
    assert.equal(savedViewIds.length, defaultViewCount);
  }, 90_000);

  test(`${context.browserName}: save current search writes one repository view without opening a tab`, async () => {
    const browser = context.browser();
    const repository = `save-${crypto.randomUUID().slice(0, 8)}`;
    const name = `Review queue ${crypto.randomUUID().slice(0, 8)}`;
    const query = `is:pr state:open label:"e2e ${crypto.randomUUID().slice(0, 8)}" sort:updated-desc`;
    await openPreview(browser, context, repository, query);
    await saveCurrentView(browser, name, query);

    const originalUrl = new URL(await browser.url());
    assert.equal(originalUrl.searchParams.get("q"), query);

    const otherRepository = `other-${repository}`;
    await browser.open(repositoryUrl(context, otherRepository, query));
    await browser.waitForControl();
    await ensureMenuOpen(browser);
    await browser.waitForText(MENU_LINK, name, false);
    const otherRepositoryLinks = await browser.attributes(`${MENU_LINK}[data-view-id]`, "href");
    assert.ok(otherRepositoryLinks.length > 0);
    assert.ok(
      otherRepositoryLinks.every(
        (href) => href !== null && new URL(href).pathname.includes(otherRepository)
      )
    );

    await browser.open(repositoryUrl(context, repository, query));
    await browser.waitForControl();
    assert.equal(
      await browser.attribute(SUMMARY, "aria-label"),
      `Pull request view: ${name}, 10 results`
    );
    await ensureMenuOpen(browser);
    await browser.waitForText(MENU_LINK, name, true);
  }, 120_000);

  test(`${context.browserName}: hidden current views keep their query until shown again`, async () => {
    const browser = context.browser();
    const repository = `hidden-${crypto.randomUUID().slice(0, 8)}`;
    const name = `Hidden queue ${crypto.randomUUID().slice(0, 8)}`;
    const query = `is:pr is:open label:hidden-${crypto.randomUUID().slice(0, 8)}`;
    await openPreview(browser, context, repository, query);
    await saveCurrentView(browser, name, query);
    const viewId = await browser.attribute(`${MENU_LINK}[aria-checked="true"]`, "data-view-id");
    assert.ok(viewId);
    await openCustomize(browser);
    await browser.click(`input[aria-label="Show ${name} in menu"]`);
    await browser.waitForElementCount(`input[aria-label="Show ${name} in menu"]:not(:checked)`, 1);
    assert.equal(new URL(await browser.url()).searchParams.get("q"), query);
    await browser.click(".gprf-save-views");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    await browser.waitForText(SUMMARY, name, true);
    await browser.waitForText(MENU_LINK, name, false);
    await browser.waitForElementCount(`${MENU_LINK}[data-view-id="${viewId}"]`, 0);

    await openCustomize(browser);
    await browser.waitForElementCount(`input[aria-label="Show ${name} in menu"]:not(:checked)`, 1);
    await browser.click(`input[aria-label="Show ${name} in menu"]`);
    await browser.click(".gprf-save-views");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    await browser.waitForText(MENU_LINK, name, true);
    const links = await browser.attributes(MENU_LINK, "href");
    const link = links.find(
      (href) => new URL(href ?? "https://github.com").searchParams.get("q") === query
    );
    assert.ok(link);
    assert.equal(new URL(link).searchParams.get("q"), query);
  }, 120_000);

  test(`${context.browserName}: separator and reorder changes stage, discard, and save together`, async () => {
    const browser = context.browser();
    const repository = `layout-${crypto.randomUUID().slice(0, 8)}`;
    await openPreview(browser, context, repository, "is:pr state:open");
    await openCustomize(browser);
    const originalSeparators = await browser.attributes(
      'button[aria-label="Reorder separator"]',
      "data-move-id"
    );
    await browser.click(".gprf-add-separator");
    await browser.waitForElementCount(
      'button[aria-label="Reorder separator"]',
      originalSeparators.length + 1
    );

    await browser.click(".gprf-view-editor-footer .gprf-view-actions button:first-child");
    await browser.waitForElementCount(".gprf-view-confirm", 1);
    await browser.click(".gprf-keep-editing");
    await browser.click(".gprf-view-editor-footer .gprf-view-actions button:first-child");
    await browser.waitForElementCount(".gprf-view-confirm", 1);
    await browser.click(".gprf-view-confirm .gprf-view-danger");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    await browser.waitForElementCount(".gprf-saved-menu[data-mode]", 0);
    await browser.waitForTabs(1);

    await openCustomize(browser);
    const before = await browser.attributes(
      ".gprf-view-editor-row button[data-move-id]",
      "data-move-id"
    );
    assert.deepEqual(
      await browser.attributes('button[aria-label="Reorder separator"]', "data-move-id"),
      originalSeparators
    );
    await browser.click(".gprf-add-separator");
    await browser.press(".gprf-view-editor-row:first-child button[data-move-id]", "ArrowDown");
    await browser.wait(100);
    const reordered = await browser.attributes(
      ".gprf-view-editor-row button[data-move-id]",
      "data-move-id"
    );
    assert.notDeepEqual(reordered, before);
    const savedSeparatorIds = await browser.attributes(
      'button[aria-label="Reorder separator"]',
      "data-move-id"
    );
    await browser.click(".gprf-save-views");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    // Leading, adjacent and trailing separators stay stored but do not render.
    const defaults = createDefaultViewLayout().entries;
    const expectedLayout = {
      version: 1 as const,
      entries: reordered.map((id) => {
        assert.ok(id);
        return defaults.find((entry) => entry.id === id) ?? { type: "divider" as const, id };
      })
    };
    await browser.waitForElementCount(
      ".gprf-view-separator",
      visibleViewEntries(expectedLayout).filter((entry) => entry.type === "divider").length
    );

    await openCustomize(browser);
    assert.deepEqual(
      await browser.attributes(".gprf-view-editor-row button[data-move-id]", "data-move-id"),
      reordered
    );
    assert.deepEqual(
      await browser.attributes('button[aria-label="Reorder separator"]', "data-move-id"),
      savedSeparatorIds
    );
    await browser.waitForTabs(1);
  }, 120_000);

  test(`${context.browserName}: complete editing session persists drafts, starter copies, and undo together`, async () => {
    const browser = context.browser();
    const repository = `session-${crypto.randomUUID().slice(0, 8)}`;
    const query = "is:pr state:open";
    const teamQuery = "is:pr state:open assignee:@me";
    await openPreview(browser, context, repository, query);
    await openCustomize(browser);
    await browser.click('[data-edit-id="builtin-open"]');
    await browser.fill('[name="name"]', "My team");
    await browser.fill('[name="query"]', teamQuery);
    await browser.click(".gprf-view-back");
    await browser.click(".gprf-add-view");
    await browser.fill('[name="name"]', "Release triage");
    await browser.click(".gprf-view-back");
    await browser.click(".gprf-save-views");
    await browser.waitForElementCount('[name="query"][aria-invalid="true"]', 1);
    assert.equal(new URL(await browser.url()).searchParams.get("q"), query);
    await browser.fill('[name="query"]', "is:pr label:release");
    await browser.click(".gprf-view-back");
    await browser.click('[data-edit-id="builtin-closed"]');
    await browser.click(".gprf-remove-view");
    await browser.waitForElementCount('[data-edit-id="builtin-closed"]', 0);
    await browser.click(".gprf-undo-delete");
    await browser.waitForElementCount('[data-edit-id="builtin-closed"]', 1);
    await browser.click(".gprf-starter-link");
    await browser.click('input[id$="-builtin-open"]');
    await browser.click(".gprf-save-views");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    assert.equal(new URL(await browser.url()).searchParams.get("q"), query);
    await browser.open(repositoryUrl(context, repository, query));
    await browser.waitForControl();
    await openCustomize(browser);
    await browser.waitForElementCount(".gprf-edit-view", 10);
    await browser.waitForText('[data-edit-id="builtin-open"]', "My team", true);
    await browser.waitForElementCount('[data-edit-id="builtin-closed"]', 1);
    await browser.click(".gprf-view-editor-footer .gprf-view-actions button:first-child");
    const originalLink = await browser.attribute(
      `${MENU_LINK}[data-view-id="builtin-open"]`,
      "href"
    );
    assert.ok(originalLink);
    assert.equal(new URL(originalLink).searchParams.get("q"), teamQuery);
    const links = await browser.attributes(MENU_LINK, "href");
    assert.equal(
      links.filter((href) => new URL(href ?? "https://github.com").searchParams.get("q") === query)
        .length,
      1
    );
    assert.ok(
      links.some(
        (href) =>
          new URL(href ?? "https://github.com").searchParams.get("q") === "is:pr label:release"
      )
    );
  }, 120_000);

  test(`${context.browserName}: the legacy page without a preview region keeps native controls visible`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().url);
    await browser.waitForText(".table-list-header-toggle.states a", "3 Open", true);
    await browser.waitForElementCount(SUMMARY, 0);
    assert.equal(
      await browser
        .attributes(".table-list-header-toggle.states a", "href")
        .then((links) => links.length),
      2
    );
    assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), "true");
  }, 90_000);

  test(`${context.browserName}: stale zero counts stay hidden until the matching list finishes`, async () => {
    const browser = context.browser();
    const fixture = context.fixture();
    await browser.open(
      fixture.urlFor({
        mode: "preview",
        query: "is:pr is:merged gprf-no-match-928471"
      })
    );
    await browser.waitForControl();
    assert.equal(await browser.text(".gprf-summary-count").then((counts) => counts[0]), "0");
    assert.equal(await browser.attribute(".gprf-summary-count", "hidden"), null);

    await browser.click("[data-fixture-reuse-count]");
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q") === "is:pr is:open draft:false"
    );
    await browser.wait(100);
    assert.notEqual(await browser.attribute(".gprf-summary-count", "hidden"), null);
    await browser.click("[data-fixture-unrelated-load]");
    await browser.wait(150);
    assert.notEqual(await browser.attribute(".gprf-summary-count", "hidden"), null);

    await browser.wait(700);
    await browser.wait(100);
    assert.equal(await browser.text(".gprf-summary-count").then((counts) => counts[0]), "0");
    assert.equal(await browser.attribute(".gprf-summary-count", "hidden"), null);
  }, 90_000);

  test(`${context.browserName}: heading mutations cannot expose a count while the associated list is loading`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "is:pr is:merged" }));
    await browser.waitForControl();
    assert.equal(await browser.attribute(".gprf-summary-count", "hidden"), null);
    await browser.click("[data-fixture-start-loading]");
    await browser.wait(100);
    assert.notEqual(await browser.attribute(".gprf-summary-count", "hidden"), null);
    await browser.click("[data-fixture-update-results]");
    await browser.wait(100);
    assert.notEqual(await browser.attribute(".gprf-summary-count", "hidden"), null);
    await browser.click("[data-fixture-unrelated-load]");
    await browser.wait(100);
    assert.notEqual(await browser.attribute(".gprf-summary-count", "hidden"), null);
    await browser.click("[data-fixture-finish-loading]");
    await browser.waitForText(".gprf-summary-count", "757", true);
    assert.equal(await browser.attribute(".gprf-summary-count", "hidden"), null);
  }, 90_000);

  test(`${context.browserName}: changing repositories invalidates the same query and unsupported routes restore native UI`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ mode: "preview", query: "is:pr is:merged" }));
    await browser.waitForControl();
    await browser.navigateRepository("/octocat/another/pulls");
    await browser.wait(150);
    assert.notEqual(await browser.attribute(".gprf-summary-count", "hidden"), null);
    await browser.click("[data-fixture-update-results]");
    await browser.waitForText(".gprf-summary-count", "757", true);
    assert.equal(await browser.attribute(".gprf-summary-count", "hidden"), null);
    await browser.navigateRepository("/octocat/another/issues");
    await browser.waitForElementCount(SUMMARY, 0);
    assert.notEqual(await browser.cssValue("[data-fixture-result-heading]", "display"), "none");
    await browser.waitForElementCount(".gprf-native-results-hidden,.gprf-native-status-hidden", 0);
  }, 90_000);

  test(`${context.browserName}: bootstrap-only pages leave native status links visible`, async () => {
    await withExtensionSession(
      context.browserName,
      { contentMode: "bootstrap-only" },
      async (browser) => {
        await browser.open(context.fixture().url);
        await browser.waitForText(".table-list-header-toggle.states a", "3 Open", true);
        await browser.waitForElementCount(SUMMARY, 0);
        assert.notEqual(
          await browser.cssValue(".table-list-header-toggle.states a:first-child", "display"),
          "none"
        );
        assert.equal(await browser.attribute("html", "data-gprf-native-ever-visible"), "true");
        await browser.open(
          context.fixture().urlFor({ mode: "preview", query: "is:pr state:open" })
        );
        await browser.waitForText("[data-fixture-preview-status] button", "Open", true);
        await browser.waitForElementCount(SUMMARY, 0);
        assert.notEqual(
          await browser.cssValue("[data-fixture-preview-status] > button:first-of-type", "display"),
          "none"
        );
        await browser.waitForNumericAttributeGreaterThan(
          "html",
          "data-gprf-native-visible-frames",
          1
        );
      }
    );
  }, 120_000);
}
