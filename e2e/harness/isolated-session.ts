import { rm } from "node:fs/promises";
import type { BrowserName, BrowserSession } from "./contracts";
import { prepareExtension, type PrepareExtensionOptions } from "./fixture";
import { startPreparedBrowserSession } from "./start-session";
import { measuredStep } from "./timing";

export async function withExtensionSession<T>(
  browserName: BrowserName,
  options: PrepareExtensionOptions,
  operation: (browser: BrowserSession) => Promise<T>
): Promise<T> {
  const prepared = await measuredStep(browserName, "prepare isolated extension", () =>
    prepareExtension(browserName, options)
  );
  let browser: BrowserSession | undefined;

  try {
    browser = await measuredStep(browserName, "start isolated browser session", () =>
      startPreparedBrowserSession(browserName, prepared)
    );
    const activeBrowser = browser;
    return await measuredStep(browserName, "run isolated browser scenario", () =>
      operation(activeBrowser)
    );
  } finally {
    if (browser) {
      const activeBrowser = browser;
      await measuredStep(browserName, "close isolated browser session", () =>
        activeBrowser.close()
      );
    }
    await rm(prepared.root, { recursive: true, force: true });
  }
}
