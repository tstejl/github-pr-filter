"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { mkdtemp, mkdir, cp, readFile, writeFile, readdir, rm } = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const BROWSER = process.env.E2E_BROWSER;
const OPTION_SELECTOR = ".gprf-lifecycle-option";

if (!new Set(["chromium", "firefox"]).has(BROWSER)) {
  throw new Error("Set E2E_BROWSER to chromium or firefox.");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fixturePage(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const query = escapeHtml(url.searchParams.get("q") || "is:pr is:open");

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
        <a class="btn-link" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=is%3Apr+is%3Aopen">3 Open</a>
        <a class="btn-link" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=is%3Apr+is%3Aclosed">2 Closed</a>
      </div>
      <div id="repo-content">Fixture pull requests</div>
    </main>
  </body>
</html>`;
}

async function startFixtureServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixturePage(request.url));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/octocat/hello-world/pulls?q=is%3Apr+is%3Aopen`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function prepareExtension() {
  const root = await mkdtemp(path.join(os.tmpdir(), "github-pr-filter-e2e-"));
  const extensionDir = path.join(root, "extension");
  await mkdir(extensionDir);
  await Promise.all([
    cp(path.join(ROOT, "src"), path.join(extensionDir, "src"), { recursive: true }),
    cp(path.join(ROOT, "assets"), path.join(extensionDir, "assets"), { recursive: true }),
    cp(path.join(ROOT, "manifest.json"), path.join(extensionDir, "manifest.json"))
  ]);

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
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
      "--source-dir", extensionDir,
      "--artifacts-dir", artifactsDir,
      "--overwrite-dest"
    ]);
    const artifact = (await readdir(artifactsDir)).find((name) => name.endsWith(".zip"));
    assert.ok(artifact, "web-ext should produce a Firefox package");
    xpiPath = path.join(artifactsDir, artifact);
  }

  return { root, extensionDir, xpiPath };
}

async function chromiumSession(extensionDir) {
  const { chromium } = require("@playwright/test");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "github-pr-filter-chromium-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });
  const page = context.pages()[0] || await context.newPage();

  return {
    async open(url) {
      await page.goto(url);
    },
    async waitForControl() {
      await page.locator(".gprf-lifecycle-summary").waitFor();
    },
    async text(selector) {
      return page.locator(selector).allTextContents();
    },
    async attribute(selector, name) {
      return page.locator(selector).getAttribute(name);
    },
    async attributes(selector, name) {
      return page.locator(selector).evaluateAll(
        (elements, attributeName) => elements.map((element) => element.getAttribute(attributeName)),
        name
      );
    },
    async cssValue(selector, name) {
      return page.locator(selector).evaluate(
        (element, property) => getComputedStyle(element).getPropertyValue(property),
        name
      );
    },
    async click(selector) {
      await page.locator(selector).click();
    },
    async search(query) {
      const input = page.locator('input[name="q"]');
      await input.fill(query);
      await input.press("Enter");
    },
    async url() {
      return page.url();
    },
    async waitForUrl(predicate) {
      await page.waitForURL((url) => predicate(url.href));
    },
    async close() {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
}

async function firefoxSession(xpiPath) {
  const { Builder, By, Key, until } = require("selenium-webdriver");
  const firefox = require("selenium-webdriver/firefox");
  const options = new firefox.Options().addArguments("-headless");
  if (process.env.FIREFOX_BIN) {
    options.setBinary(process.env.FIREFOX_BIN);
  }

  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build();
  await driver.installAddon(xpiPath, true);

  async function elements(selector) {
    return driver.findElements(By.css(selector));
  }

  return {
    async open(url) {
      await driver.get(url);
    },
    async waitForControl() {
      await driver.wait(until.elementLocated(By.css(".gprf-lifecycle-summary")), 15_000);
    },
    async text(selector) {
      return Promise.all((await elements(selector)).map((element) => element.getText()));
    },
    async attribute(selector, name) {
      return (await driver.findElement(By.css(selector))).getAttribute(name);
    },
    async attributes(selector, name) {
      return Promise.all(
        (await elements(selector)).map((element) => element.getAttribute(name))
      );
    },
    async cssValue(selector, name) {
      return (await driver.findElement(By.css(selector))).getCssValue(name);
    },
    async click(selector) {
      await driver.findElement(By.css(selector)).click();
    },
    async search(query) {
      const input = await driver.findElement(By.css('input[name="q"]'));
      await input.clear();
      await input.sendKeys(query, Key.ENTER);
    },
    async url() {
      return driver.getCurrentUrl();
    },
    async waitForUrl(predicate) {
      await driver.wait(async () => predicate(await driver.getCurrentUrl()), 15_000);
    },
    async close() {
      await driver.quit();
    }
  };
}

test(`${BROWSER}: lifecycle menu follows query state`, { timeout: 90_000 }, async (t) => {
  const fixture = await startFixtureServer();
  const extension = await prepareExtension();
  let browser;

  t.after(async () => {
    await browser?.close();
    await fixture.close();
    await rm(extension.root, { recursive: true, force: true });
  });

  browser = BROWSER === "chromium"
    ? await chromiumSession(extension.extensionDir)
    : await firefoxSession(extension.xpiPath);

  await browser.open(fixture.url);
  await browser.waitForControl();

  assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);
  assert.deepEqual(await browser.text(".gprf-summary-count"), ["3"]);
  assert.equal(
    await browser.attribute(".gprf-lifecycle-summary", "aria-label"),
    "3 pull requests: Open"
  );
  assert.deepEqual(
    await browser.text(".gprf-lifecycle-summary > .gprf-lifecycle-icon"),
    []
  );
  const nativeClasses = await browser.attribute(
    ".table-list-header-toggle.states > a:first-child",
    "class"
  );
  assert.ok(nativeClasses.split(/\s+/).includes("gprf-native-status-hidden"));

  await browser.click(".gprf-lifecycle-summary");
  assert.notEqual(await browser.cssValue(".gprf-summary-count", "display"), "none");
  assert.deepEqual(await browser.text(".gprf-option-label"), [
    "Open", "Ready", "Draft", "Closed", "Merged", "Closed without merging"
  ]);
  const menuIconPaths = await browser.attributes(
    ".gprf-lifecycle-option > .gprf-lifecycle-icon:first-child path",
    "d"
  );
  assert.equal(menuIconPaths.length, 6);
  assert.equal(new Set(menuIconPaths).size, 6);

  await browser.click(`${OPTION_SELECTOR}[data-lifecycle="draft"]`);
  await browser.waitForUrl((url) => new URL(url).searchParams.get("q")?.includes("draft:true"));
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

  await browser.search("is:pr is:closed draft:true");
  await browser.waitForUrl((url) => (
    new URL(url).searchParams.get("q") === "is:pr is:closed draft:true"
  ));
  await browser.waitForControl();
  assert.deepEqual(await browser.text(".gprf-summary-label"), ["Closed"]);
  assert.deepEqual(await browser.text(".gprf-summary-count"), ["2"]);

  await browser.click(".gprf-lifecycle-summary");
  await browser.click(`${OPTION_SELECTOR}[data-lifecycle="closed_unmerged"]`);
  await browser.waitForUrl((url) => (
    new URL(url).searchParams.get("q")?.includes("is:unmerged")
  ));
  await browser.waitForControl();
  assert.deepEqual(
    await browser.text(".gprf-summary-label"),
    ["Closed without merging"]
  );
  assert.deepEqual(await browser.text(".gprf-summary-count"), ["2"]);

  await browser.click(".js-clear-search");
  await browser.waitForUrl((url) => !new URL(url).searchParams.has("q"));
  await browser.waitForControl();
  assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);

  await browser.click(".gprf-lifecycle-summary");
  await browser.click(`${OPTION_SELECTOR}[data-lifecycle="draft"]`);
  await browser.waitForUrl((url) => new URL(url).searchParams.get("q")?.includes("draft:true"));
  await browser.waitForControl();

  const cleanUrl = new URL(await browser.url());
  cleanUrl.search = "";
  await browser.open(cleanUrl.href);
  await browser.waitForControl();
  assert.equal(new URL(await browser.url()).searchParams.has("q"), false);
  assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);
  assert.deepEqual(await browser.text(".gprf-summary-count"), ["3"]);
});
