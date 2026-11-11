import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";

const ROOT = path.resolve(import.meta.dir, "..");

function withFixture(source: string, exercise: (directory: string, file: string) => void): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "gprf-toolchain-"));
  const file = path.join(directory, "fixture.ts");
  try {
    writeFileSync(file, source);
    writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: path.join(ROOT, "tsconfig.json"),
        compilerOptions: { types: [] },
        include: ["fixture.ts"]
      })
    );
    return exercise(directory, file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(args: string[]): { exitCode: number; output: string } {
  const result = Bun.spawnSync([process.execPath, ...args], { cwd: ROOT });
  return {
    exitCode: result.exitCode,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)
  };
}

function lint(directory: string, file: string): { exitCode: number; output: string } {
  return run([
    "x",
    "--no-install",
    "oxlint",
    "--config",
    path.join(ROOT, ".oxlintrc.json"),
    "--tsconfig",
    path.join(directory, "tsconfig.json"),
    "--deny-warnings",
    file
  ]);
}

test("the configured checker rejects type errors, explicit undefined, and unchecked indexing", () => {
  withFixture(
    `
export const port: number = "3000";
export const options: { name?: string } = { name: undefined };
export const item: string = ["one"][1];
export function maybe(flag: boolean) { if (flag) return 1; }
export class Parent { value(): number { return 1; } }
export class Child extends Parent { value(): number { return 2; } }
export function choose(value: 0 | 1): number {
  switch (value) { case 0: console.log("zero"); case 1: return 1; }
}
`,
    (directory) => {
      const result = run(["check", "--no-script", "-p", directory]);
      assert.equal(result.exitCode, 1, result.output);
      assert.match(result.output, /TS2322/);
      assert.match(result.output, /TS2375/);
      assert.match(result.output, /Type 'string \| undefined' is not assignable to type 'string'/);
      assert.match(result.output, /TS7030/);
      assert.match(result.output, /TS4114/);
      assert.match(result.output, /TS7029/);
    }
  );
});

test("browser bundling rejects a type error before writing output", async () => {
  // Keep the fixture alive until Bun.build finishes its asynchronous check.
  const directory = mkdtempSync(path.join(os.tmpdir(), "gprf-checked-build-"));
  try {
    const file = path.join(directory, "fixture.ts");
    writeFileSync(file, 'export const port: number = "3000";');
    const result = await Bun.build({
      entrypoints: [file],
      target: "browser",
      check: true,
      throw: false
    });
    assert.equal(result.success, false);
    assert.equal(result.outputs.length, 0);
    assert.ok(result.logs.some((log) => log.message.includes("TS2322")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("type-aware rules reject voided promises, incomplete switches, and unsafe JSON values", () => {
  withFixture(
    `
export function work(): Promise<void> { return Promise.resolve(); }
void work();
export function transition(event: "open" | "close"): void {
  switch (event) { case "open": return; }
}
export const unchecked = JSON.parse('{"name":"view"}');
`,
    (directory, file) => {
      const result = lint(directory, file);
      assert.equal(result.exitCode, 1, result.output);
      assert.match(result.output, /no-floating-promises/);
      assert.match(result.output, /switch-exhaustiveness-check/);
      assert.match(result.output, /no-unsafe-assignment/);
    }
  );
});

test("the same checker and lint engine accept well-typed complete code", () => {
  withFixture(
    `
export const port: number = 3000;
export function transition(event: "open" | "close"): boolean {
  switch (event) { case "open": return true; case "close": return false; }
}
export function work(): Promise<void> { return Promise.resolve(); }
work().catch((error: unknown) => console.error(error));
`,
    (directory, file) => {
      const checked = run(["check", "--no-script", "-p", directory]);
      assert.equal(checked.exitCode, 0, checked.output);
      const linted = lint(directory, file);
      assert.equal(linted.exitCode, 0, linted.output);
    }
  );
});
