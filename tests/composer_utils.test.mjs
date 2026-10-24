import assert from "node:assert/strict";
import test from "node:test";

import composerUtils from "../public/modules/composer-utils.js";

const {
  SPECIAL_KEY_GROUPS,
  flattenSpecialKeys,
  getSpecialKeyById,
  shouldSendWithoutEnterOnKeydown,
  getPassthroughKeyOnKeydown,
  shouldSubmitOnKeydown
} = composerUtils;

test("Enter submits, Shift+Enter inserts a newline, Alt+Enter sends without Enter", () => {
  const key = (overrides) => ({ key: "Enter", shiftKey: false, altKey: false, isComposing: false, ...overrides });
  assert.equal(shouldSubmitOnKeydown(key({})), true);
  assert.equal(shouldSubmitOnKeydown(key({ shiftKey: true })), false);
  assert.equal(shouldSubmitOnKeydown(key({ altKey: true })), false);
  assert.equal(shouldSubmitOnKeydown(key({ isComposing: true })), false);
  assert.equal(shouldSendWithoutEnterOnKeydown(key({ altKey: true })), true);
  assert.equal(shouldSendWithoutEnterOnKeydown(key({})), false);
  assert.equal(shouldSendWithoutEnterOnKeydown(key({ altKey: true, isComposing: true })), false);
});

test("special key menu exposes common terminal controls", () => {
  const keys = flattenSpecialKeys(SPECIAL_KEY_GROUPS);
  const ids = keys.map((item) => item.id);

  // Agent prompt keys lead because they are the most used on phones.
  assert.deepEqual(ids.slice(0, 7), ["shift-left", "alt-up", "shift-tab", "escape", "tab", "ctrl-c", "ctrl-d"]);
  assert.ok(ids.includes("backspace"));
  assert.ok(ids.includes("delete"));
  assert.ok(ids.includes("ctrl-a"));
  assert.ok(ids.includes("ctrl-e"));
  assert.ok(ids.includes("ctrl-k"));
  assert.ok(ids.includes("ctrl-l"));
  assert.ok(ids.includes("ctrl-u"));
  assert.ok(ids.includes("ctrl-w"));
  assert.ok(ids.includes("arrow-up"));
  assert.ok(ids.includes("arrow-down"));
});

test("special key lookup returns kitty key payloads", () => {
  assert.equal(getSpecialKeyById("tab").key, "tab");
  assert.equal(getSpecialKeyById("ctrl-a").key, "ctrl+a");
  assert.equal(getSpecialKeyById("arrow-left").key, "left");
  assert.equal(getSpecialKeyById("shift-left").key, "shift+left");
  assert.equal(getSpecialKeyById("alt-up").key, "alt+up");
  assert.equal(getSpecialKeyById("missing"), null);
});

test("arrow keys and Esc pass through to the pane only while the composer is empty and unmodified", () => {
  const key = (name, overrides = {}) => ({ key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...overrides });
  assert.equal(getPassthroughKeyOnKeydown(key("ArrowUp"), ""), "up");
  assert.equal(getPassthroughKeyOnKeydown(key("ArrowDown"), ""), "down");
  assert.equal(getPassthroughKeyOnKeydown(key("ArrowLeft"), ""), "left");
  assert.equal(getPassthroughKeyOnKeydown(key("ArrowRight"), ""), "right");
  assert.equal(getPassthroughKeyOnKeydown(key("ArrowUp"), "draft"), null);
  assert.equal(getPassthroughKeyOnKeydown(key("ArrowUp", { shiftKey: true }), ""), null);
  assert.equal(getPassthroughKeyOnKeydown(key("ArrowUp", { isComposing: true }), ""), null);
  assert.equal(getPassthroughKeyOnKeydown(key("Escape"), ""), "escape");
  assert.equal(getPassthroughKeyOnKeydown(key("Escape"), "draft"), null);
  assert.equal(getPassthroughKeyOnKeydown(key("Tab"), ""), null);
});
