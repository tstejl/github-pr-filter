import { chromium } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, test } from "bun:test";
import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Builder, By, Key, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";

type BrowserName = "chromium" | "firefox";

interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

interface PreparedExtension {
  root: string;
  extensionDir: string;
  xpiPath: string | null;
}

interface BrowserSession {
  open: (url: string) => Promise<void>;
  openNewTab: (url: string) => Promise<void>;
  switchToTab: (index: number) => Promise<void>;
  waitForControl: () => Promise<void>;
  waitForText: (selector: string, text: string, present: boolean) => Promise<void>;
  text: (selector: string) => Promise<string[]>;
  attribute: (selector: string, name: string) => Promise<string | null>;
  attributes: (selector: string, name: string) => Promise<(string | null)[]>;
  cssValue: (selector: string, name: string) => Promise<string>;
  click: (selector: string) => Promise<void>;
  clickReplacing: (selector: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  url: () => Promise<string>;
  waitForUrl: (predicate: (url: string) => boolean) => Promise<void>;
  mutationCount: (selector: string, duration: number) => Promise<number>;
  close: () => Promise<void>;
}

type FirefoxWebDriver = WebDriver & {
  installAddon: (addonPath: string, temporary?: boolean) => Promise<string>;
};

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dir, "..");
const browserValue = process.env.E2E_BROWSER;
const OPTION_SELECTOR = ".gprf-lifecycle-option";

if (browserValue !== "chromium" && browserValue !== "firefox") {
  throw new Error("Set E2E_BROWSER to chromium or firefox.");
}
const BROWSER: BrowserName = browserValue;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fixturePage(requestUrl: string): string {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const rawQuery = url.searchParams.get("q") || "is:pr is:open";
  const query = escapeHtml(rawQuery);
  const nativeStatusLinks = /(?:^|\s)is:merged(?:\s|$)/i.test(rawQuery)
    ? `<a class="btn-link" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=${encodeURIComponent(rawQuery)}">4 Total</a>`
    : `<a class="btn-link" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=is%3Apr+is%3Aopen">3 Open</a>
        <a class="btn-link" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=is%3Apr+is%3Aclosed">2 Closed</a>`;

  return `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">
  <head>
    <meta charset="utf-8">
    <title>Pull requests</title>
  </head>
  <body>
    <main>
      <form role="search" action="/octocat/hello-world/pulls" method="get">
        <input aria-label="Search all issues" name="q" type="search" value="${query}">
      </form>
      <a class="js-clear-search" href="/octocat/hello-world/pulls">
        Clear current search query, filters, and sorts
      </a>
      <div class="table-list-header-toggle states">
        ${nativeStatusLinks}
      </div>
      <div id="repo-content">Fixture pull requests</div>
    </main>
  </body>
</html>`;
}

async function startFixtureServer(): Promise<FixtureServer> {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixturePage(request.url ?? "/"));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/octocat/hello-world/pulls?q=is%3Apr+is%3Aopen`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

async function prepareExtension(): Promise<PreparedExtension> {
  const root = await mkdtemp(path.join(os.tmpdir(), "github-pr-filter-e2e-"));
  const extensionDir = path.join(root, "extension");
  await mkdir(extensionDir);
  await cp(path.join(ROOT, "dist", "extension"), extensionDir, { recursive: true });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    content_scripts: Array<{ matches: string[] }>;
  };
  for (const script of manifest.content_scripts) {
    script.matches = ["http://127.0.0.1/*"];
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let xpiPath = null;
  if (BROWSER === "firefox") {
    const artifactsDir = path.join(root, "artifacts");
    const webExt = path.join(ROOT, "node_modules", ".bin", "web-ext");
    await execFileAsync(webExt, [
      "build",
      "--source-dir",
      extensionDir,
      "--artifacts-dir",
      artifactsDir,
      "--overwrite-dest"
    ]);
    const artifact = (await readdir(artifactsDir)).find((name) => name.endsWith(".zip"));
    assert.ok(artifact, "web-ext should produce a Firefox package");
    xpiPath = path.join(artifactsDir, artifact);
  }

  return { root, extensionDir, xpiPath };
}

async function chromiumSession(extensionDir: string): Promise<BrowserSession> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "github-pr-filter-chromium-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  let page = context.pages()[0] || (await context.newPage());

  return {
    async open(url: string) {
      await page.goto(url);
    },
    async openNewTab(url: string) {
      page = await context.newPage();
      await page.goto(url);
    },
    async switchToTab(index: number) {
      const nextPage = context.pages()[index];
      assert.ok(nextPage, `Missing Chromium tab ${index}`);
      page = nextPage;
      await page.bringToFront();
    },
    async waitForControl() {
      await page.locator(".gprf-lifecycle-summary").waitFor();
    },
    async waitForText(selector: string, expected: string, present: boolean) {
      await page.waitForFunction(
        ({ selector: target, expected: text, present: shouldBePresent }) => {
          const contents = [...document.querySelectorAll(target)].map(
            (element) => element.textContent ?? ""
          );
          return contents.some((content) => content.includes(text)) === shouldBePresent;
        },
        { selector, expected, present }
      );
    },
    async text(selector: string) {
      return page.locator(selector).allTextContents();
    },
    async attribute(selector: string, name: string) {
      return page.locator(selector).getAttribute(name);
    },
    async attributes(selector: string, name: string) {
      return page
        .locator(selector)
        .evaluateAll(
          (elements, attributeName: string) =>
            elements.map((element) => element.getAttribute(attributeName)),
          name
        );
    },
    async cssValue(selector: string, name: string) {
      return page
        .locator(selector)
        .evaluate(
          (element, property: string) => getComputedStyle(element).getPropertyValue(property),
          name
        );
    },
    async click(selector: string) {
      await page.locator(selector).click();
    },
    async clickReplacing(selector: string) {
      await page.locator(selector).click();
    },
    async search(query: string) {
      const input = page.locator('input[name="q"]');
      await input.fill(query);
      await input.press("Enter");
    },
    async url() {
      return page.url();
    },
    async waitForUrl(predicate: (url: string) => boolean) {
      await page.waitForURL((url) => predicate(url.href));
    },
    async mutationCount(selector: string, duration: number) {
      return page.locator(selector).evaluate(
        (element, wait) =>
          new Promise<number>((resolve) => {
            let count = 0;
            const observer = new MutationObserver((mutations) => {
              count += mutations.length;
            });
            observer.observe(element, { childList: true, subtree: true });
            setTimeout(() => {
              observer.disconnect();
              resolve(count);
            }, wait);
          }),
        duration
      );
    },
    async close() {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
}

async function firefoxSession(xpiPath: string): Promise<BrowserSession> {
  const options = new firefox.Options().addArguments("-headless");
  if (process.env.FIREFOX_BIN) {
    options.setBinary(process.env.FIREFOX_BIN);
  }

  const driver = (await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build()) as FirefoxWebDriver;
  await driver.installAddon(xpiPath, true);

  return {
    async open(url: string) {
      await driver.get(url);
    },
    async openNewTab(url: string) {
      await driver.switchTo().newWindow("tab");
      await driver.get(url);
    },
    async switchToTab(index: number) {
      const handles = await driver.getAllWindowHandles();
      const handle = handles[index];
      assert.ok(handle, `Missing Firefox tab ${index}`);
      await driver.switchTo().window(handle);
    },
    async waitForControl() {
      await driver.wait(until.elementLocated(By.css(".gprf-lifecycle-summary")), 15_000);
    },
    async waitForText(selector: string, expected: string, present: boolean) {
      await driver.wait(
        async () =>
          driver.executeScript<boolean>(
            "const contents = Array.from(document.querySelectorAll(arguments[0]), element => element.textContent || ''); return contents.some(content => content.includes(arguments[1])) === arguments[2]",
            selector,
            expected,
            present
          ),
        15_000
      );
    },
    async text(selector: string) {
      return driver.executeScript<string[]>(
        "return Array.from(document.querySelectorAll(arguments[0]), element => (element.textContent || '').trim())",
        selector
      );
    },
    async attribute(selector: string, name: string) {
      return driver.executeScript<string | null>(
        "return document.querySelector(arguments[0])?.getAttribute(arguments[1]) ?? null",
        selector,
        name
      );
    },
    async attributes(selector: string, name: string) {
      return driver.executeScript<(string | null)[]>(
        "return Array.from(document.querySelectorAll(arguments[0]), element => element.getAttribute(arguments[1]))",
        selector,
        name
      );
    },
    async cssValue(selector: string, name: string) {
      return driver.executeScript<string>(
        "const element = document.querySelector(arguments[0]); return element ? getComputedStyle(element).getPropertyValue(arguments[1]) : ''",
        selector,
        name
      );
    },
    async click(selector: string) {
      await driver.executeScript(
        "const element = document.querySelector(arguments[0]); if (!element) throw new Error(`Missing ${arguments[0]}`); element.click();",
        selector
      );
    },
    async clickReplacing(selector: string) {
      await driver.executeScript(
        "const element = document.querySelector(arguments[0]); if (!element) throw new Error(`Missing ${arguments[0]}`); element.click();",
        selector
      );
    },
    async search(query: string) {
      const input = await driver.findElement(By.css('input[name="q"]'));
      await input.clear();
      await input.sendKeys(query, Key.ENTER);
    },
    async url() {
      return driver.getCurrentUrl();
    },
    async waitForUrl(predicate: (url: string) => boolean) {
      await driver.wait(async () => predicate(await driver.getCurrentUrl()), 15_000);
    },
    async mutationCount(selector: string, duration: number) {
      return driver.executeAsyncScript<number>(
        "const done = arguments[arguments.length - 1]; const element = document.querySelector(arguments[0]); if (!element) { done(-1); return; } let count = 0; const observer = new MutationObserver(mutations => { count += mutations.length; }); observer.observe(element, { childList: true, subtree: true }); setTimeout(() => { observer.disconnect(); done(count); }, arguments[1]);",
        selector,
        duration
      );
    },
    async close() {
      await driver.quit();
    }
  };
}

let activeFixture: FixtureServer | undefined;
let activeBrowser: BrowserSession | undefined;
let preparedExtension: PreparedExtension | undefined;

beforeAll(async () => {
  preparedExtension = await prepareExtension();
}, 30_000);

beforeEach(async () => {
  if (!preparedExtension) {
    throw new Error("E2E extension preparation did not complete.");
  }
  activeFixture = await startFixtureServer();
  if (BROWSER === "firefox" && !preparedExtension.xpiPath) {
    throw new Error("Firefox E2E packaging did not produce an extension archive.");
  }
  activeBrowser =
    BROWSER === "chromium"
      ? await chromiumSession(preparedExtension.extensionDir)
      : await firefoxSession(preparedExtension.xpiPath as string);
}, 30_000);

afterEach(async () => {
  await activeBrowser?.close();
  await activeFixture?.close();
  activeFixture = undefined;
  activeBrowser = undefined;
}, 30_000);

afterAll(async () => {
  if (preparedExtension) {
    await rm(preparedExtension.root, { recursive: true, force: true });
  }
  preparedExtension = undefined;
}, 30_000);

test(`${BROWSER}: query navigation, counts, and Turbo integration`, async () => {
  const fixture = activeFixture as FixtureServer;
  const browser = activeBrowser as BrowserSession;

  await browser.open(fixture.url);
  await browser.waitForControl();
  assert.equal(await browser.mutationCount(".gprf-lifecycle", 250), 0);

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
    "Closed without merging"
  ]);
  const menuIconPaths = await browser.attributes(
    ".gprf-lifecycle-option > .gprf-lifecycle-icon:first-child path",
    "d"
  );
  assert.equal(menuIconPaths.length, 7);
  assert.equal(new Set(menuIconPaths).size, 7);

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

  await browser.search("is:pr is:open");
  await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === "is:pr is:open");
  await browser.waitForControl();
  assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);

  await browser.search("state:open label:bug");
  await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === "state:open label:bug");
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
  assert.deepEqual(await browser.text(".gprf-summary-label"), ["Closed"]);
  assert.deepEqual(await browser.text(".gprf-summary-count"), ["2"]);

  await browser.click(".gprf-lifecycle-summary");
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

test(`${BROWSER}: repository customization persists, cancels, resets, and synchronizes`, async () => {
  const fixture = activeFixture as FixtureServer;
  const browser = activeBrowser as BrowserSession;
  const cleanUrl = new URL(fixture.url);
  cleanUrl.search = "";

  await browser.open(cleanUrl.href);
  await browser.waitForControl();

  await browser.openNewTab(cleanUrl.href);
  await browser.waitForControl();
  await browser.switchToTab(0);

  await browser.click(".gprf-lifecycle-summary");
  await browser.clickReplacing(".gprf-configure-action");
  await browser.clickReplacing('.gprf-editor-row[data-lifecycle="draft"] .gprf-editor-visibility');
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
  await browser.clickReplacing('.gprf-editor-row[data-lifecycle="draft"] .gprf-editor-visibility');
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

test(`${BROWSER}: global pull request pages remain untouched`, async () => {
  const fixture = activeFixture as FixtureServer;
  const browser = activeBrowser as BrowserSession;
  const globalUrl = new URL(fixture.url);
  globalUrl.pathname = "/pulls";
  await browser.open(globalUrl.href);
  assert.deepEqual(await browser.text(".gprf-lifecycle-summary"), []);
  assert.equal(
    ((await browser.attribute("html", "class")) || "").includes("gprf-supported-page"),
    false
  );
}, 90_000);
