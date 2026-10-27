import assert from "node:assert/strict";
import test from "node:test";

import layoutUtils from "../public/modules/layout-utils.js";
import paneTree from "../public/modules/pane-tree.js";

const actor = { targetId: "mc-tmux", socket: "/tmp/tmux-503/default", windowId: 3 };

test("decodeLayoutPayload keeps the tree, the active view and a pinned Browser", () => {
  const leaf = paneTree.leaf(actor);
  const payload = layoutUtils.decodeLayoutPayload({
    paneRoot: leaf,
    activePaneId: leaf.id,
    browser: { url: "file:///tmp/report.html", targetId: "mc-tmux", extra: 1 }
  });
  assert.equal(payload.activePaneId, leaf.id);
  assert.equal(payload.paneRoot.actor.windowId, 3);
  assert.deepEqual(payload.browser, { url: "file:///tmp/report.html", targetId: "mc-tmux" });
});

test("decodeLayoutPayload returns null without a tree and drops an empty Browser", () => {
  assert.equal(layoutUtils.decodeLayoutPayload(null), null);
  assert.equal(layoutUtils.decodeLayoutPayload({ paneRoot: null }), null);
  const leaf = paneTree.leaf(actor);
  assert.equal(layoutUtils.decodeLayoutPayload({ paneRoot: leaf, activePaneId: leaf.id, browser: { url: "" } }).browser, null);
  assert.equal(layoutUtils.normalizeBrowserState({ url: "https://x", targetId: 7 }).targetId, "");
});
