import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../public/modules/mobile-utils.js", import.meta.url), "utf8");
const window = { matchMedia: () => ({ matches: true }) };
// Same realm as the test, so arrays compare by structure.
new Function("window", source)(window);
const { pushScreen, popScreen, replaceTop, stackForHistoryEntry } = window.KRDMobileUtils;
const SCREENS = new Set(["connect", "sessions", "layouts", "reports", "chat", "browser"]);

test("push nests new screens and returns to screens already on the stack", () => {
  assert.deepEqual(pushScreen(["connect"], "sessions"), ["connect", "sessions"]);
  assert.deepEqual(pushScreen(["connect", "sessions", "chat"], "browser"), ["connect", "sessions", "chat", "browser"]);
  // Opening a report from the Browser's Reports screen goes back to the Browser, not deeper.
  assert.deepEqual(pushScreen(["connect", "sessions", "chat", "browser", "reports"], "browser"), ["connect", "sessions", "chat", "browser"]);
  assert.deepEqual(pushScreen(["connect", "sessions", "chat"], "sessions"), ["connect", "sessions"]);
  assert.deepEqual(pushScreen(["connect"], "connect"), ["connect"]);
});

test("pop stops at the base; replaceTop swaps the top or unwinds to an existing screen", () => {
  assert.deepEqual(popScreen(["connect", "sessions", "chat"]), ["connect", "sessions"]);
  assert.deepEqual(popScreen(["connect"]), ["connect"]);
  assert.deepEqual(replaceTop(["connect", "sessions", "reports"], "layouts"), ["connect", "sessions", "layouts"]);
  assert.deepEqual(replaceTop(["connect", "sessions", "reports"], "connect"), ["connect"]);
});

test("history entries from this page load pick a depth; foreign entries reset to the base", () => {
  const stack = ["connect", "sessions", "chat", "browser"];
  const entry = (screen, index, nonce = "n1") => ({ krdMobileScreen: screen, krdIndex: index, krdNonce: nonce });
  const common = { stack, key: "krdMobileScreen", nonce: "n1", allowedScreens: SCREENS };
  assert.deepEqual(stackForHistoryEntry({ ...common, entry: entry("chat", 2) }), { stack: ["connect", "sessions", "chat"], screen: "chat", foreign: false });
  assert.deepEqual(stackForHistoryEntry({ ...common, entry: entry("sessions", 1) }).stack, ["connect", "sessions"]);
  assert.deepEqual(stackForHistoryEntry({ ...common, entry: entry("reports", 4) }).stack, [...stack, "reports"]);
  assert.deepEqual(stackForHistoryEntry({ ...common, entry: entry("chat", 2, "old") }), { stack: ["connect"], screen: "connect", foreign: true });
  assert.equal(stackForHistoryEntry({ ...common, entry: null }).foreign, true);
  assert.equal(stackForHistoryEntry({ ...common, entry: entry("nonsense", 1) }).foreign, true);
});
