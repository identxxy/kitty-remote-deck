import assert from "node:assert/strict";
import test from "node:test";

import terminalLines from "../public/modules/terminal-lines.js";

const { splitLines, computeLineDelta, applyLineDelta } = terminalLines;
const lines = (count, prefix = "line") => Array.from({ length: count }, (_, index) => `${prefix} ${index}`);
const roundTrip = (oldLines, newLines) => assert.deepEqual(applyLineDelta(oldLines, computeLineDelta(oldLines, newLines)), newLines);

test("appended output is described as a short tail", () => {
  const before = lines(100);
  const after = [...before.slice(0, 99), "line 99 edited", "new 1", "new 2"];
  const delta = computeLineDelta(before, after);
  assert.deepEqual([delta.drop, delta.keep, delta.tail], [0, 99, ["line 99 edited", "new 1", "new 2"]]);
  roundTrip(before, after);
});

test("lines scrolled off the top are dropped instead of resending everything", () => {
  const before = lines(2000);
  const after = [...before.slice(37), ...lines(37, "fresh")];
  const delta = computeLineDelta(before, after);
  assert.equal(delta.drop, 37);
  assert.equal(delta.keep, 1963);
  assert.equal(delta.tail.length, 37);
  roundTrip(before, after);
});

test("unrelated text keeps nothing; splitting preserves the text exactly", () => {
  const before = lines(50);
  const after = lines(50, "other");
  const delta = computeLineDelta(before, after);
  assert.deepEqual([delta.drop, delta.keep], [50, 0]);
  roundTrip(before, after);
  roundTrip([], after);
  roundTrip(before, []);
  const text = "a\n\x1b[1mb\x1b[0m\n\n\nc\n";
  assert.equal(splitLines(text).join("\n"), text);
});
