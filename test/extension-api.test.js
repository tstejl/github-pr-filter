const test = require("node:test");
const assert = require("node:assert/strict");

const createExtensionApi = require("../src/extension-api.js");

function storageNamespace(name, calls) {
  return {
    storage: {
      local: {
        async get(key) {
          calls.push([name, "get", key]);
          return { [key]: { lifecycle: "draft" } };
        },
        async set(value) {
          calls.push([name, "set", value]);
        }
      }
    }
  };
}

test("prefers Firefox's promise-based browser namespace", async () => {
  const calls = [];
  const api = createExtensionApi({
    browser: storageNamespace("browser", calls),
    chrome: storageNamespace("chrome", calls)
  });

  assert.deepEqual(await api.get("preferences"), {
    preferences: { lifecycle: "draft" }
  });
  await api.set({ preferences: { lifecycle: "ready" } });
  assert.deepEqual(calls, [
    ["browser", "get", "preferences"],
    ["browser", "set", { preferences: { lifecycle: "ready" } }]
  ]);
});

test("falls back to Chromium's chrome namespace", async () => {
  const calls = [];
  const api = createExtensionApi({ chrome: storageNamespace("chrome", calls) });

  await api.get("preferences");
  assert.deepEqual(calls, [["chrome", "get", "preferences"]]);
});

test("returns null when extension storage is unavailable", () => {
  assert.equal(createExtensionApi({}), null);
});
