import * as assert from "node:assert/strict";
import { Builder, By, Key, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import type { BrowserSession } from "./contracts";
import { measuredStep } from "./timing";

type FirefoxWebDriver = WebDriver & {
  installAddon: (addonPath: string, temporary?: boolean) => Promise<string>;
};

async function closeFirefoxWindows(
  driver: FirefoxWebDriver,
  handles: readonly string[]
): Promise<void> {
  const [handle, ...remainingHandles] = handles;
  if (!handle) return;
  await driver.switchTo().window(handle);
  await driver.close();
  await closeFirefoxWindows(driver, remainingHandles);
}

export async function firefoxSession(xpiPath: string): Promise<BrowserSession> {
  const options = new firefox.Options().addArguments("-headless");
  if (process.env.FIREFOX_BIN) {
    options.setBinary(process.env.FIREFOX_BIN);
  }

  const driver = (await measuredStep("firefox", "create Firefox WebDriver", () =>
    new Builder().forBrowser("firefox").setFirefoxOptions(options).build()
  )) as FirefoxWebDriver;
  try {
    await measuredStep("firefox", "install Firefox add-on", () =>
      driver.installAddon(xpiPath, true)
    );
  } catch (error: unknown) {
    await driver.quit();
    throw error;
  }

  return {
    async open(url: string) {
      await driver.get(url);
    },
    async wait(duration: number) {
      await driver.sleep(duration);
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
    async waitForElementCount(selector: string, count: number) {
      await driver.wait(
        async () =>
          driver.executeScript<boolean>(
            "return document.querySelectorAll(arguments[0]).length === arguments[1]",
            selector,
            count
          ),
        15_000
      );
    },
    async waitForNumericAttributeGreaterThan(selector: string, name: string, value: number) {
      await driver.wait(
        async () =>
          driver.executeScript<boolean>(
            "const rawValue = document.querySelector(arguments[0])?.getAttribute(arguments[1]); return Number(rawValue || '0') > arguments[2];",
            selector,
            name,
            value
          ),
        15_000
      );
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
    async setUnsubmittedSearchQuery(query: string) {
      await driver.executeScript(
        "const input = document.querySelector('input[name=\"q\"]'); if (!input) throw new Error('Missing search input'); input.value = arguments[0]; input.dispatchEvent(new Event('input', { bubbles: true }));",
        query
      );
    },
    async setCommittedSearchQuery(query: string) {
      await driver.executeScript(
        "const input = Array.from(document.querySelectorAll('input[name=\"q\"]')).find(candidate => candidate.getClientRects().length > 0); if (!input) throw new Error('Missing visible search input'); input.setAttribute('value', arguments[0]);",
        query
      );
    },
    async replaceUrlQuery(query: string) {
      await driver.executeScript(
        "const url = new URL(location.href); url.searchParams.set('q', arguments[0]); history.replaceState({}, '', url);",
        query
      );
    },
    async swapResponsiveSearchFields() {
      await driver.executeScript(
        "const stale = document.querySelector('[data-fixture-search=\"stale\"]'); const committed = document.querySelector('[data-fixture-search=\"committed\"]'); if (!stale || !committed) throw new Error('Missing responsive search fixtures'); stale.style.display = ''; committed.style.display = 'none'; window.dispatchEvent(new Event('resize'));"
      );
    },
    async appendUnrelatedDomMutation() {
      await driver.executeScript(
        "const marker = document.createElement('span'); marker.className = 'fixture-unrelated-mutation'; document.querySelector('#repo-content')?.append(marker);"
      );
    },
    async url() {
      return driver.getCurrentUrl();
    },
    async waitForUrl(predicate: (url: string) => boolean) {
      await driver.wait(async () => predicate(await driver.getCurrentUrl()), 15_000);
    },
    async duplicateLifecycleControl() {
      await driver.executeScript(
        "const group = document.querySelector('.table-list-header-toggle.states'); const control = group?.querySelector(':scope > .gprf-lifecycle'); if (!group || !control) throw new Error('Missing native lifecycle control'); group.append(control.cloneNode(true)); document.dispatchEvent(new Event('turbo:load'));"
      );
    },
    async removeLifecycleControl() {
      await driver.executeScript(
        "const control = document.querySelector('.gprf-lifecycle'); if (!control) throw new Error('Missing lifecycle control'); control.remove();"
      );
    },
    async replaceNativeStatusHeaderWithoutSignal() {
      const error = await driver.executeAsyncScript<string | null>(
        "const done = arguments[arguments.length - 1]; const previousGroups = Array.from(document.querySelectorAll('.table-list-header-toggle.states')); const replacement = document.createElement('div'); replacement.className = 'table-list-header-toggle states'; replacement.dataset.fixtureGroup = 'overlap-replacement'; replacement.textContent = 'Loading replacement controls'; document.querySelector('main')?.append(replacement); const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve)); (async () => { await nextFrame(); await nextFrame(); replacement.innerHTML = '<a class=\"btn-link selected\" data-turbo-frame=\"repo-content\" href=\"?q=is%3Apr+is%3Aopen\">3 Open</a><a class=\"btn-link\" data-turbo-frame=\"repo-content\" href=\"?q=is%3Apr+is%3Aclosed\">2 Closed</a>'; await nextFrame(); await nextFrame(); previousGroups.forEach(group => group.remove()); done(null); })().catch(reason => done(String(reason)));"
      );
      assert.equal(error, null);
    },
    async navigateRepository(pathname: string) {
      await driver.executeScript(
        "const url = new URL(location.href); url.pathname = arguments[0]; history.pushState({}, '', url); document.dispatchEvent(new Event('turbo:load'));",
        pathname
      );
    },
    async setNativeStatusHeader(present: boolean) {
      await driver.executeScript(
        "document.querySelectorAll('.table-list-header-toggle.states').forEach(group => group.remove()); if (arguments[0]) { const group = document.createElement('div'); group.className = 'table-list-header-toggle states'; group.innerHTML = '<a class=\"btn-link selected\" data-turbo-frame=\"repo-content\" href=\"?q=is%3Apr+is%3Aopen\">3 Open</a><a class=\"btn-link\" data-turbo-frame=\"repo-content\" href=\"?q=is%3Apr+is%3Aclosed\">2 Closed</a>'; document.querySelector('main')?.append(group); } document.dispatchEvent(new Event('turbo:load'));",
        present
      );
    },
    async setEligibleMountTargets(present: boolean) {
      await driver.executeScript(
        "document.querySelectorAll('.gprf-waiting-native').forEach(element => element.remove()); document.querySelectorAll('.table-list-header-toggle.states').forEach(group => group.remove()); document.querySelectorAll('form[role=\"search\"]').forEach(form => form.remove()); const main = document.querySelector('main'); if (arguments[0]) { const group = document.createElement('div'); group.className = 'table-list-header-toggle states'; group.innerHTML = '<a class=\"btn-link selected\" data-turbo-frame=\"repo-content\" href=\"?q=is%3Apr+is%3Aopen\">3 Open</a><a class=\"btn-link\" data-turbo-frame=\"repo-content\" href=\"?q=is%3Apr+is%3Aclosed\">2 Closed</a>'; main?.append(group); } else { const group = document.createElement('div'); group.className = 'table-list-header-toggle states gprf-waiting-native'; group.innerHTML = '<a class=\"btn-link\" href=\"/octocat/hello-world/issues\">Loading native controls</a>'; main?.append(group); } document.dispatchEvent(new Event('turbo:load'));",
        present
      );
    },
    async mutationCount(selector: string, duration: number) {
      return driver.executeAsyncScript<number>(
        "const done = arguments[arguments.length - 1]; const element = document.querySelector(arguments[0]); if (!element) { done(-1); return; } let count = 0; const observer = new MutationObserver(mutations => { count += mutations.length; }); observer.observe(element, { childList: true, subtree: true }); setTimeout(() => { observer.disconnect(); done(count); }, arguments[1]);",
        selector,
        duration
      );
    },
    async reset() {
      const [firstHandle, ...extraHandles] = await driver.getAllWindowHandles();
      assert.ok(firstHandle, "Firefox session should retain its initial window");
      await closeFirefoxWindows(driver, extraHandles);
      await driver.switchTo().window(firstHandle);
      await driver.get("about:blank");
    },
    async close() {
      await driver.quit();
    }
  };
}
