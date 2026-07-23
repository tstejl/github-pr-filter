import { test } from "bun:test";
import * as assert from "node:assert/strict";
import {
  clearPageMarkers,
  createPageMarkerController,
  markReplacementMounted,
  REPLACEMENT_MOUNTED_CLASS,
  REPLACEMENT_PENDING_CLASS,
  type PageMarkerRoot
} from "../src/page-markers";

function markerFixture(): {
  readonly root: PageMarkerRoot;
  readonly has: (name: string) => boolean;
} {
  const names = new Set<string>();
  return {
    root: {
      classList: {
        add: (...tokens: string[]) => {
          for (const token of tokens) {
            names.add(token);
          }
        },
        remove: (...tokens: string[]) => {
          for (const token of tokens) {
            names.delete(token);
          }
        }
      }
    },
    has: (name) => names.has(name)
  };
}

test("a supported replacement remains pending until the extension mounts", () => {
  const marker = markerFixture();
  const controller = createPageMarkerController({
    root: () => marker.root
  });

  controller.update(true);
  assert.equal(marker.has(REPLACEMENT_PENDING_CLASS), true);
  assert.equal(marker.has(REPLACEMENT_MOUNTED_CLASS), false);

  controller.update(true);
  assert.equal(marker.has(REPLACEMENT_PENDING_CLASS), true);
  assert.equal(marker.has(REPLACEMENT_MOUNTED_CLASS), false);
});

test("a confirmed mount replaces pending state until the next navigation", () => {
  const marker = markerFixture();
  const controller = createPageMarkerController({
    root: () => marker.root
  });

  controller.update(true);
  markReplacementMounted(marker.root);

  assert.equal(marker.has(REPLACEMENT_PENDING_CLASS), false);
  assert.equal(marker.has(REPLACEMENT_MOUNTED_CLASS), true);

  clearPageMarkers(marker.root);
  assert.equal(marker.has(REPLACEMENT_PENDING_CLASS), false);
  assert.equal(marker.has(REPLACEMENT_MOUNTED_CLASS), false);
});

test("leaving a supported route clears every replacement marker", () => {
  const marker = markerFixture();
  const controller = createPageMarkerController({
    root: () => marker.root
  });

  controller.update(true);
  markReplacementMounted(marker.root);
  controller.update(false);

  assert.equal(marker.has(REPLACEMENT_PENDING_CLASS), false);
  assert.equal(marker.has(REPLACEMENT_MOUNTED_CLASS), false);
});

test("extension teardown clears every replacement marker", () => {
  const marker = markerFixture();
  const controller = createPageMarkerController({
    root: () => marker.root
  });

  controller.update(true);
  controller.destroy();

  assert.equal(marker.has(REPLACEMENT_PENDING_CLASS), false);
  assert.equal(marker.has(REPLACEMENT_MOUNTED_CLASS), false);
});
