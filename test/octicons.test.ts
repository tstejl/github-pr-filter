import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { OCTICONS } from "../src/octicons";

test("configuration icons keep their intended Primer geometries", () => {
  assert.equal(OCTICONS.gear.viewBox, "0 0 24 24");
  assert.equal(OCTICONS.eyeClosed.viewBox, "0 0 16 16");
  assert.equal(OCTICONS.x.viewBox, "0 0 16 16");
  assert.match(OCTICONS.gear.path, /^M16 12/);
  assert.match(OCTICONS.eyeClosed.path, /^M\.143 2\.31/);
  assert.match(OCTICONS.x.path, /^M3\.72 3\.72/);
});
