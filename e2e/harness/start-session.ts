import * as assert from "node:assert/strict";
import { chromiumSession } from "./chromium-session";
import type { BrowserName, BrowserSession, PreparedExtension } from "./contracts";
import { firefoxSession } from "./firefox-session";

export function startPreparedBrowserSession(
  browserName: BrowserName,
  prepared: PreparedExtension
): Promise<BrowserSession> {
  if (browserName === "chromium") {
    return chromiumSession(prepared.extensionDir);
  }
  assert.ok(prepared.xpiPath, "Firefox fixture should produce an extension archive");
  return firefoxSession(prepared.xpiPath);
}
