import assert from "node:assert/strict";
import test from "node:test";

import composerUtils from "../public/modules/composer-utils.js";

const { SPECIAL_KEY_GROUPS, flattenSpecialKeys, getSpecialKeyById } = composerUtils;

test("special key menu exposes common terminal controls", () => {
  const keys = flattenSpecialKeys(SPECIAL_KEY_GROUPS);
  const ids = keys.map((item) => item.id);

  assert.deepEqual(ids.slice(0, 5), ["escape", "tab", "ctrl-c", "ctrl-d", "ctrl-a"]);
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
  assert.equal(getSpecialKeyById("missing"), null);
});
