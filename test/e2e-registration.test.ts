import { describe, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  auditE2ESpecs,
  validateSpecCatalog,
  type SpecCatalogEntry
} from "../scripts/check-e2e-registration";
import { registerCatalogSpecs } from "../e2e/harness/spec-registration";
import type { E2ETestContext } from "../e2e/harness/contracts";

const active = { file: "active.ts", status: "active", register: "registerActive" } as const;
const retired = {
  file: "old.ts",
  status: "retired",
  reason: "Classic UI support was removed.",
  replacements: ["e2e/specs/active.ts", "test/query-predicates.test.ts"]
} as const;
const modules = new Map([
  ["active.ts", "export function registerActive() {}"],
  ["old.ts", "export function registerOld() {}"]
]);
function validate(specs: unknown[], sources = modules) {
  return validateSpecCatalog({ version: 1, specs }, sources, (file) =>
    ["e2e/specs/active.ts", "e2e/specs/old.ts", "test/query-predicates.test.ts"].includes(file)
  );
}

describe("E2E catalog audit", () => {
  test("classifies active and retired specs without evaluating their test modules", () => {
    expect(validate([active, retired])).toEqual([active, retired]);
  });
  test("a newly added module cannot silently become an orphan", () => {
    expect(() =>
      validate(
        [active, retired],
        new Map([...modules, ["forgotten.ts", "export function registerForgotten() {}"]])
      )
    ).toThrow("Unregistered E2E specs: forgotten.ts");
    expect(() => validate([active])).toThrow("Unregistered E2E specs: old.ts");
  });
  test("stale files and duplicate status declarations fail", () => {
    expect(() => validate([active, retired, { ...active, file: "deleted.ts" }])).toThrow(
      "missing spec: deleted.ts"
    );
    expect(() =>
      validate([
        active,
        retired,
        { ...active, status: "retired", reason: "Removed", replacements: [] }
      ])
    ).toThrow("Duplicate E2E catalog entry: active.ts");
  });
  test("an active module must export its declared registrar", () => {
    expect(() => validate([{ ...active, register: "registerTypo" }, retired])).toThrow(
      "does not export registerTypo"
    );
    expect(() => validate([{ ...active, register: "" }, retired])).toThrow(
      "needs a registrar export"
    );
  });
  test("retirement needs a nonempty reason and cannot retain active registration", () => {
    expect(() => validate([active, { ...retired, reason: " \n " }])).toThrow("needs a reason");
    expect(() => validate([active, { ...retired, register: "registerOld" }])).toThrow(
      "cannot have an active registrar"
    );
    expect(() => validate([{ ...active, reason: "Removed" }, retired])).toThrow(
      "cannot carry retirement metadata"
    );
  });
  test("replacement coverage must exist and cannot point at another retired module", () => {
    expect(() =>
      validate([active, { ...retired, replacements: ["test/deleted.test.ts"] }])
    ).toThrow("existing replacement test paths");
    expect(() => validate([active, { ...retired, replacements: ["e2e/specs/old.ts"] }])).toThrow(
      "inactive replacement coverage"
    );
    expect(validate([active, { ...retired, replacements: [] }])).toHaveLength(2);
  });
  test("invalid schemas, unknown statuses, and disabling every active module fail", () => {
    expect(() => validateSpecCatalog({ version: 2, specs: [] }, modules, () => true)).toThrow(
      "version: 1"
    );
    expect(() => validate([{ ...active, status: "disabled" }, retired])).toThrow(
      "must be active or retired"
    );
    expect(() =>
      validate([
        { ...retired, file: "active.ts", replacements: [] },
        { ...retired, replacements: [] }
      ])
    ).toThrow("at least one active spec");
  });
  test("specs and replacement references cannot escape the repository", () => {
    for (const file of [
      "../active.ts",
      "/active.ts",
      "C:/active.ts",
      "folder/../active.ts",
      "folder\\active.ts"
    ])
      expect(() => validate([{ ...active, file }, retired])).toThrow("relative .ts spec path");
    expect(() =>
      validate([active, { ...retired, replacements: ["test/../../outside.ts"] }])
    ).toThrow("existing replacement test paths");
  });
});

function withRepository(exercise: (root: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), "gprf-spec-catalog-"));
  mkdirSync(path.join(root, "e2e/specs/nested"), { recursive: true });
  writeFileSync(
    path.join(root, "e2e/lifecycle.e2e.ts"),
    'import { registerE2ESpecs } from "./harness/spec-registration"; await registerE2ESpecs({});'
  );
  writeFileSync(
    path.join(root, "e2e/specs/nested/active.ts"),
    "export function registerActive() {}"
  );
  writeFileSync(
    path.join(root, "e2e/spec-catalog.json"),
    JSON.stringify({ version: 1, specs: [{ ...active, file: "nested/active.ts" }] })
  );
  try {
    exercise(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
describe("on-disk discovery", () => {
  test("nested spec discovery detects an unlisted file", () => {
    withRepository((root) => {
      expect(auditE2ESpecs(root)).toHaveLength(1);
      writeFileSync(path.join(root, "e2e/specs/nested/new.ts"), "export function registerNew() {}");
      expect(() => auditE2ESpecs(root)).toThrow("Unregistered E2E specs: nested/new.ts");
    });
  });
  test("unsupported executable extensions cannot bypass the audit", () => {
    withRepository((root) => {
      writeFileSync(path.join(root, "e2e/specs/orphan.js"), "export function registerNew() {}");
      expect(() => auditE2ESpecs(root)).toThrow("E2E specs must be .ts modules");
    });
  });
  test("replacing catalog execution with manual registration is rejected", () => {
    withRepository((root) => {
      writeFileSync(
        path.join(root, "e2e/lifecycle.e2e.ts"),
        'import { registerOne } from "./specs/nested/active"; registerOne();'
      );
      expect(() => auditE2ESpecs(root)).toThrow("must use the audited spec-registration loader");
    });
  });
  test("the checked-in frame regression suite remains active", () => {
    expect(auditE2ESpecs().find((entry) => entry.file === "anti-flicker.ts")?.status).toBe(
      "active"
    );
  });
});

describe("catalog execution", () => {
  const context: E2ETestContext = {
    browserName: "chromium",
    browser: () => {
      throw new Error("No browser needed for registration tests");
    },
    fixture: () => {
      throw new Error("No fixture needed for registration tests");
    }
  };
  test("every active registrar runs once with the shared context; retired modules are never loaded", async () => {
    const loaded: string[] = [];
    const registered: string[] = [];
    const entries: SpecCatalogEntry[] = [
      active,
      { ...retired, replacements: [...retired.replacements] },
      { file: "another.ts", status: "active", register: "registerAnother" }
    ];
    await registerCatalogSpecs(entries, context, async (file) => {
      loaded.push(file);
      const registrar = (actual: E2ETestContext) => {
        expect(actual).toBe(context);
        registered.push(file);
      };
      return file === "active.ts" ? { registerActive: registrar } : { registerAnother: registrar };
    });
    expect(loaded).toEqual(["active.ts", "another.ts"]);
    expect(registered).toEqual(["active.ts", "another.ts"]);
  });
  test("a noncallable export and an import failure stop test collection", async () => {
    await rejects(
      registerCatalogSpecs([active], context, async () => ({ registerActive: "not a function" })),
      /must export callable/
    );
    await rejects(
      registerCatalogSpecs([active], context, () =>
        Promise.reject(new Error("Module could not load"))
      ),
      /Module could not load/
    );
  });
});
