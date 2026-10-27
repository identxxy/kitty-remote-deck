import assert from "node:assert/strict";
import test from "node:test";

import resize from "../public/modules/resize-utils.js";

const range = { min: 320, maxFraction: 0.7, default: 560 };

test("browser drawer may grow to 70% of a wide window while the terminal keeps 180px", () => {
  const wide = resize.browserWidthBounds({ viewportWidth: 2560, activityWidth: 54, sidebarWidth: 320, range });
  assert.deepEqual(wide, { min: 320, max: 1792 });
  const laptop = resize.browserWidthBounds({ viewportWidth: 1440, activityWidth: 54, sidebarWidth: 320, range });
  assert.deepEqual(laptop, { min: 320, max: 886 });
  const noSidebar = resize.browserWidthBounds({ viewportWidth: 1440, activityWidth: 54, sidebarWidth: 0, range });
  assert.equal(noSidebar.max, 1008);
});

test("browser drawer bounds never invert in a narrow window", () => {
  const cramped = resize.browserWidthBounds({ viewportWidth: 760, activityWidth: 54, sidebarWidth: 320, range });
  // 760 - 54 - 320 - 180 leaves 206px, below the 260px floor: both bounds settle on the floor.
  assert.deepEqual(cramped, { min: 260, max: 260 });
  const phone = resize.browserWidthBounds({ viewportWidth: 430, activityWidth: 0, sidebarWidth: 320, range });
  assert.deepEqual(phone, { min: 260, max: 334 });
});

test("sidebar bounds scale with the viewport", () => {
  const sidebarRange = { min: 220, max: 520 };
  assert.deepEqual(resize.sidebarWidthBounds(1440, sidebarRange), sidebarRange);
  assert.deepEqual(resize.sidebarWidthBounds(900, sidebarRange), { min: 220, max: 324 });
  assert.deepEqual(resize.sidebarWidthBounds(430, sidebarRange), { min: 160, max: 180 });
});
