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

test("special key menu groups agent keys by program and keeps terminal controls", () => {
  const keys = flattenSpecialKeys(SPECIAL_KEY_GROUPS);
  const ids = keys.map((item) => item.id);

  assert.deepEqual(SPECIAL_KEY_GROUPS.map((group) => group.label), ["Claude Code", "Codex", "Terminal", "Line editing", "Navigation"]);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  // Claude Code keys lead because they are the most used on phones.
  assert.deepEqual(ids.slice(0, 4), ["claude-shift-tab", "claude-esc-esc", "claude-ctrl-b", "claude-send-now"]);
  for (const id of ["codex-shift-tab", "codex-tab", "codex-shift-left", "escape", "tab", "ctrl-c", "ctrl-d", "ctrl-d-twice",
    "backspace", "delete", "ctrl-a", "ctrl-e", "ctrl-k", "ctrl-l", "ctrl-u", "ctrl-w", "arrow-up", "arrow-down"]) {
    assert.ok(ids.includes(id), id);
  }
  for (const item of keys) {
    assert.ok(item.keys ? Array.isArray(item.keys) && item.keys.length > 1 && !item.key : typeof item.key === "string", item.id);
  }
});

test("special key lookup returns kitty key payloads, chords and repeats", () => {
  assert.equal(getSpecialKeyById("tab").key, "tab");
  assert.equal(getSpecialKeyById("ctrl-a").key, "ctrl+a");
  assert.equal(getSpecialKeyById("arrow-left").key, "left");
  assert.equal(getSpecialKeyById("codex-shift-left").key, "shift+left");
  assert.equal(getSpecialKeyById("claude-ctrl-b").key, "ctrl+b");
  assert.deepEqual(getSpecialKeyById("claude-send-now").keys, ["ctrl+x", "ctrl+s"]);
  assert.deepEqual(getSpecialKeyById("claude-kill-agents").keys, ["ctrl+x", "ctrl+k"]);
  assert.deepEqual([getSpecialKeyById("claude-esc-esc").key, getSpecialKeyById("claude-esc-esc").repeat], ["escape", 2]);
  assert.equal(getSpecialKeyById("ctrl-d-twice").repeat, 2);
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
