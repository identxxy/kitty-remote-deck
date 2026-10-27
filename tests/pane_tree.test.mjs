import assert from "node:assert/strict";
import test from "node:test";

import paneTree from "../public/modules/pane-tree.js";

const { leaf, leaves, splitPane, closePane, resizePaneSplit, replacePaneActor, decodePersistedPaneLayout, firstPaneId } = paneTree;

const actor = (windowId) => ({ targetId: "mc-tmux", socket: "/tmp/tmux-503/default", windowId });

test("split keeps the source leaf first and the new leaf second", () => {
  const root = leaf(actor(1), "a");
  const { tree, newPaneId } = splitPane(root, "a", "horizontal", actor(1), { paneId: "b", splitId: "s1" });
  assert.equal(newPaneId, "b");
  assert.equal(tree.kind, "split");
  assert.equal(tree.direction, "horizontal");
  assert.equal(tree.ratio, 0.5);
  assert.deepEqual(leaves(tree).map((item) => item.id), ["a", "b"]);
  assert.equal(firstPaneId(tree), "a");
});

test("closing a leaf collapses its split onto the sibling; closing the last leaf yields null", () => {
  const { tree } = splitPane(leaf(actor(1), "a"), "a", "vertical", actor(2), { paneId: "b", splitId: "s1" });
  const remaining = closePane(tree, "a");
  assert.equal(remaining.kind, "leaf");
  assert.equal(remaining.id, "b");
  assert.equal(remaining.actor.windowId, 2);
  assert.equal(closePane(remaining, "b"), null);
});

test("ratio stays inside 0.2–0.8 and actors can be replaced in place", () => {
  const { tree } = splitPane(leaf(actor(1), "a"), "a", "horizontal", actor(1), { paneId: "b", splitId: "s1" });
  assert.equal(resizePaneSplit(tree, "s1", 0.05).ratio, 0.2);
  assert.equal(resizePaneSplit(tree, "s1", 0.95).ratio, 0.8);
  const replaced = replacePaneActor(tree, "b", { targetId: "gpu-box-tmux", socket: "", windowId: 7 });
  assert.deepEqual(leaves(replaced)[1].actor, { targetId: "gpu-box-tmux", socket: "", windowId: 7 });
  assert.equal(leaves(replaced)[0].actor.windowId, 1);
});

test("persisted layouts are validated and the active pane falls back to the first leaf", () => {
  const { tree } = splitPane(leaf(actor(1), "a"), "a", "horizontal", actor(2), { paneId: "b", splitId: "s1" });
  const restored = decodePersistedPaneLayout(JSON.parse(JSON.stringify({ paneVersion: 1, paneRoot: tree, activePaneId: "zzz" })));
  assert.equal(restored.activePaneId, "a");
  assert.deepEqual(leaves(restored.paneRoot).map((item) => item.actor.windowId), [1, 2]);
  assert.throws(() => decodePersistedPaneLayout({ paneVersion: 2, paneRoot: null, activePaneId: null }));
  assert.throws(() => decodePersistedPaneLayout({ paneVersion: 1, paneRoot: { kind: "split", id: "x" }, activePaneId: null }));
  assert.throws(() =>
    decodePersistedPaneLayout({
      paneVersion: 1,
      paneRoot: { kind: "split", id: "s", direction: "horizontal", ratio: 0.5, first: leaf(actor(1), "dup"), second: leaf(actor(2), "dup") },
      activePaneId: null
    })
  );
});
