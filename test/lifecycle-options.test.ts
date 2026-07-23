import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { CustomLifecycleReason } from "../src/lifecycle";
import { CUSTOM_LIFECYCLE_OPTION, customLifecycleOption } from "../src/lifecycle-options";

test("safe Custom selections explain that no preset matches", () => {
  for (const reason of [
    "partial",
    "conflicting",
    "ambiguous"
  ] as const satisfies readonly CustomLifecycleReason[]) {
    assert.equal(customLifecycleOption(reason), CUSTOM_LIFECYCLE_OPTION);
  }
});

test("unsafe Custom selections explain why preset actions are unavailable", () => {
  for (const reason of [
    "correlated",
    "unsupported",
    "invalid"
  ] as const satisfies readonly CustomLifecycleReason[]) {
    assert.deepEqual(customLifecycleOption(reason), {
      ...CUSTOM_LIFECYCLE_OPTION,
      description: "Presets can’t be applied safely",
      help: "This GitHub query can’t be safely changed by the extension. Edit the search query directly to choose another view."
    });
  }
});
