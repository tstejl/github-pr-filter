import { expect, test } from "bun:test";
import { pickerPlacement } from "../src/menu-overlay";

const viewport = { top: 0, left: 0, width: 1200, height: 900 };
const anchor = { top: 120, bottom: 152, left: 80 };

test("picker fits natural content below the trigger and caps the entire panel", () => {
  expect(pickerPlacement({ anchor, viewport, width: 248, naturalHeight: 478 })).toEqual({
    side: "below",
    left: 80,
    top: 160,
    maxHeight: 560
  });
  expect(pickerPlacement({ anchor, viewport, width: 248, naturalHeight: 1500 })).toMatchObject({
    side: "below",
    top: 160,
    maxHeight: 560
  });
});
test("short menus stay below when they fit, even if there is more room above", () => {
  expect(
    pickerPlacement({
      anchor: { top: 600, bottom: 632, left: 80 },
      viewport,
      width: 248,
      naturalHeight: 150
    })
  ).toMatchObject({ side: "below", top: 640, maxHeight: 252 });
});
test("picker flips above when that provides more room for its contents", () => {
  expect(
    pickerPlacement({
      anchor: { top: 724, bottom: 756, left: 80 },
      viewport: { ...viewport, height: 800 },
      width: 248,
      naturalHeight: 478
    })
  ).toEqual({ side: "above", left: 80, top: 238, maxHeight: 560 });
});
test("short viewports constrain the panel to the larger available side", () => {
  expect(
    pickerPlacement({
      anchor: { top: 140, bottom: 172, left: 30 },
      viewport: { top: 0, left: 0, width: 390, height: 480 },
      width: 248,
      naturalHeight: 1500
    })
  ).toEqual({ side: "below", left: 30, top: 180, maxHeight: 292 });
});
test("placement accounts for visual viewport offsets and clamps horizontal overflow", () => {
  expect(
    pickerPlacement({
      anchor: { top: 700, bottom: 732, left: 550 },
      viewport: { top: 200, left: 100, width: 500, height: 600 },
      width: 248,
      naturalHeight: 1500
    })
  ).toEqual({ side: "above", left: 344, top: 208, maxHeight: 484 });
});
test("scrolling the anchor outside the viewport cannot push the picker offscreen", () => {
  const placement = pickerPlacement({
    anchor: { top: 1000, bottom: 1032, left: -30 },
    viewport: { ...viewport, height: 600 },
    width: 248,
    naturalHeight: 478
  });
  expect(placement).toEqual({ side: "above", left: 8, top: 114, maxHeight: 560 });
});
