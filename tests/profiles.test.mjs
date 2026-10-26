import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import profiles from "../server/profiles.js";
import paneTree from "../public/modules/pane-tree.js";

const { createProfileStore, normalizeProfile } = profiles;
const actor = (windowId) => ({ targetId: "mc-tmux", socket: "/tmp/tmux-503/default", windowId });

function sampleLayout() {
  const { tree } = paneTree.splitPane(paneTree.leaf(actor(1), "a"), "a", "horizontal", actor(2), { paneId: "b", splitId: "s1" });
  return { paneRoot: tree, activePaneId: "b" };
}

test("normalizeProfile validates the name and the pane tree", () => {
  const profile = normalizeProfile({ name: "  GPU   boxes ", ...sampleLayout() });
  assert.equal(profile.name, "GPU boxes");
  assert.match(profile.id, /^profile-/);
  assert.deepEqual(paneTree.leaves(profile.paneRoot).map((leaf) => leaf.actor.windowId), [1, 2]);
  assert.equal(profile.activePaneId, "b");
  assert.throws(() => normalizeProfile({ name: "", ...sampleLayout() }), /name is required/);
  assert.throws(() => normalizeProfile({ name: "x", paneRoot: null }), /at least one view/);
  assert.throws(() => normalizeProfile({ name: "x", paneRoot: { kind: "nonsense" } }));
  // A stale active id falls back to the first leaf.
  assert.equal(normalizeProfile({ name: "x", paneRoot: sampleLayout().paneRoot, activePaneId: "zzz" }).activePaneId, "a");
});

test("store creates, overwrites by id, lists and removes profiles", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-profiles-"));
  try {
    const store = createProfileStore(path.join(dir, "profiles.json"));
    assert.deepEqual(await store.list(), []);
    const first = await store.upsert({ name: "one", ...sampleLayout() });
    const second = await store.upsert({ name: "two", paneRoot: paneTree.leaf(actor(3), "c"), activePaneId: "c" });
    assert.deepEqual((await store.list()).map((item) => item.name), ["one", "two"]);

    const replaced = await store.upsert({ id: first.id, name: "one again", paneRoot: paneTree.leaf(actor(9), "z"), activePaneId: "z" });
    assert.equal(replaced.id, first.id);
    assert.equal(replaced.createdAt, first.createdAt);
    const listed = await store.list();
    assert.deepEqual(listed.map((item) => [item.name, paneTree.leaves(item.paneRoot)[0].actor.windowId]), [["one again", 9], ["two", 3]]);

    await store.remove(second.id);
    assert.deepEqual((await store.list()).map((item) => item.id), [first.id]);
    await assert.rejects(store.remove("missing"), /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
