import { chromium } from "@playwright/test";
import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserSession } from "./contracts";

export async function chromiumSession(extensionDir: string): Promise<BrowserSession> {
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
    async wait(duration: number) {
      await page.waitForTimeout(duration);
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
    async waitForElementCount(selector: string, count: number) {
      await page.waitForFunction(
        ({ selector: target, count: expected }) =>
          document.querySelectorAll(target).length === expected,
        { selector, count }
      );
    },
    async waitForNumericAttributeGreaterThan(selector: string, name: string, value: number) {
      await page.waitForFunction(
        ({ selector: target, name: attributeName, value: threshold }) => {
          const rawValue = document.querySelector(target)?.getAttribute(attributeName);
          return Number(rawValue ?? "0") > threshold;
        },
        { selector, name, value }
      );
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
    async setUnsubmittedSearchQuery(query: string) {
      await page.locator('input[name="q"]').fill(query);
    },
    async setCommittedSearchQuery(query: string) {
      await page.evaluate((committedQuery) => {
        const input = [...document.querySelectorAll<HTMLInputElement>('input[name="q"]')].find(
          (candidate) => candidate.getClientRects().length > 0
        );
        if (!input) {
          throw new Error("Missing visible search input");
        }
        input.setAttribute("value", committedQuery);
      }, query);
    },
    async replaceUrlQuery(query: string) {
      await page.evaluate((committedQuery) => {
        const url = new URL(location.href);
        url.searchParams.set("q", committedQuery);
        history.replaceState({}, "", url);
      }, query);
    },
    async swapResponsiveSearchFields() {
      await page.evaluate(() => {
        const stale = document.querySelector<HTMLElement>('[data-fixture-search="stale"]');
        const committed = document.querySelector<HTMLElement>('[data-fixture-search="committed"]');
        if (!stale || !committed) {
          throw new Error("Missing responsive search fixtures");
        }
        stale.style.display = "";
        committed.style.display = "none";
        window.dispatchEvent(new Event("resize"));
      });
    },
    async appendUnrelatedDomMutation() {
      await page.evaluate(() => {
        const marker = document.createElement("span");
        marker.className = "fixture-unrelated-mutation";
        document.querySelector("#repo-content")?.append(marker);
      });
    },
    async url() {
      return page.url();
    },
    async waitForUrl(predicate: (url: string) => boolean) {
      await page.waitForURL((url) => predicate(url.href));
    },
    async duplicateLifecycleControl() {
      await page.evaluate(() => {
        const group = document.querySelector(".table-list-header-toggle.states");
        const control = group?.querySelector(":scope > .gprf-lifecycle");
        if (!group || !control) {
          throw new Error("Missing native lifecycle control");
        }
        group.append(control.cloneNode(true));
        document.dispatchEvent(new Event("turbo:load"));
      });
    },
    async removeLifecycleControl() {
      await page.evaluate(() => {
        const control = document.querySelector(".gprf-lifecycle");
        if (!control) {
          throw new Error("Missing lifecycle control");
        }
        control.remove();
      });
    },
    async replaceNativeStatusHeaderWithoutSignal() {
      await page.evaluate(async () => {
        const previousGroups = [...document.querySelectorAll(".table-list-header-toggle.states")];
        const replacement = document.createElement("div");
        replacement.className = "table-list-header-toggle states";
        replacement.dataset.fixtureGroup = "overlap-replacement";
        replacement.textContent = "Loading replacement controls";
        document.querySelector("main")?.append(replacement);

        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        replacement.innerHTML =
          '<a class="btn-link selected" data-turbo-frame="repo-content" href="?q=is%3Apr+is%3Aopen">3 Open</a>' +
          '<a class="btn-link" data-turbo-frame="repo-content" href="?q=is%3Apr+is%3Aclosed">2 Closed</a>';
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        previousGroups.forEach((group) => group.remove());
      });
    },
    async navigateRepository(pathname: string) {
      await page.evaluate((nextPathname) => {
        const url = new URL(location.href);
        url.pathname = nextPathname;
        history.pushState({}, "", url);
        document.dispatchEvent(new Event("turbo:load"));
      }, pathname);
    },
    async setNativeStatusHeader(present: boolean) {
      await page.evaluate((shouldBePresent) => {
        document.querySelectorAll(".table-list-header-toggle.states").forEach((group) => {
          group.remove();
        });
        if (shouldBePresent) {
          const group = document.createElement("div");
          group.className = "table-list-header-toggle states";
          group.innerHTML =
            '<a class="btn-link selected" data-turbo-frame="repo-content" href="?q=is%3Apr+is%3Aopen">3 Open</a>' +
            '<a class="btn-link" data-turbo-frame="repo-content" href="?q=is%3Apr+is%3Aclosed">2 Closed</a>';
          document.querySelector("main")?.append(group);
        }
        document.dispatchEvent(new Event("turbo:load"));
      }, present);
    },
    async setEligibleMountTargets(present: boolean) {
      await page.evaluate((shouldBePresent) => {
        document.querySelectorAll(".gprf-waiting-native").forEach((element) => element.remove());
        document.querySelectorAll(".table-list-header-toggle.states").forEach((group) => {
          group.remove();
        });
        document.querySelectorAll('form[role="search"]').forEach((form) => form.remove());

        const main = document.querySelector("main");
        if (shouldBePresent) {
          const group = document.createElement("div");
          group.className = "table-list-header-toggle states";
          group.innerHTML =
            '<a class="btn-link selected" data-turbo-frame="repo-content" href="?q=is%3Apr+is%3Aopen">3 Open</a>' +
            '<a class="btn-link" data-turbo-frame="repo-content" href="?q=is%3Apr+is%3Aclosed">2 Closed</a>';
          main?.append(group);
        } else {
          const group = document.createElement("div");
          group.className = "table-list-header-toggle states gprf-waiting-native";
          group.innerHTML =
            '<a class="btn-link" href="/octocat/hello-world/issues">Loading native controls</a>';
          main?.append(group);
        }

        document.dispatchEvent(new Event("turbo:load"));
      }, present);
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
    async reset() {
      const [firstPage, ...extraPages] = context.pages();
      assert.ok(firstPage, "Chromium session should retain its initial page");
      await Promise.all(extraPages.map((extraPage) => extraPage.close()));
      page = firstPage;
      await page.goto("about:blank");
    },
    async close() {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
}
