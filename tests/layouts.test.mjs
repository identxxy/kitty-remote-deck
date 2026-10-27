import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import layouts from "../server/layouts.js";
import paneTree from "../public/modules/pane-tree.js";

const { createLayoutStore, normalizeLayout } = layouts;
const actor = (windowId) => ({ targetId: "mc-tmux", socket: "/tmp/tmux-503/default", windowId });

function sampleLayout() {
  const { tree } = paneTree.splitPane(paneTree.leaf(actor(1), "a"), "a", "horizontal", actor(2), { paneId: "b", splitId: "s1" });
  return { paneRoot: tree, activePaneId: "b" };
}

test("normalizeLayout validates the name and the pane tree", () => {
  const layout = normalizeLayout({ name: "  GPU   boxes ", ...sampleLayout() });
  assert.equal(layout.name, "GPU boxes");
  assert.match(layout.id, /^layout-/);
  assert.deepEqual(paneTree.leaves(layout.paneRoot).map((leaf) => leaf.actor.windowId), [1, 2]);
  assert.equal(layout.activePaneId, "b");
  assert.throws(() => normalizeLayout({ name: "", ...sampleLayout() }), /name is required/);
  assert.throws(() => normalizeLayout({ name: "x", paneRoot: null }), /at least one view/);
  assert.throws(() => normalizeLayout({ name: "x", paneRoot: { kind: "nonsense" } }));
  // A stale active id falls back to the first leaf.
  assert.equal(normalizeLayout({ name: "x", paneRoot: sampleLayout().paneRoot, activePaneId: "zzz" }).activePaneId, "a");
});

test("store creates, overwrites by id, lists and removes layouts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-layouts-"));
  try {
    const store = createLayoutStore(path.join(dir, "layouts.json"));
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

test("normalizeLayout keeps a pinned Browser and rejects bad URLs", () => {
  const withBrowser = normalizeLayout({ name: "x", ...sampleLayout(), browser: { url: " file:///tmp/report.html ", targetId: "mc-tmux" } });
  assert.deepEqual(withBrowser.browser, { url: "file:///tmp/report.html", targetId: "mc-tmux" });
  assert.equal(normalizeLayout({ name: "x", ...sampleLayout() }).browser, null);
  assert.equal(normalizeLayout({ name: "x", ...sampleLayout(), browser: { url: "" } }).browser, null);
  assert.throws(() => normalizeLayout({ name: "x", ...sampleLayout(), browser: { url: "javascript:alert(1)" } }), /http, https or file/);
  assert.throws(() => normalizeLayout({ name: "x", ...sampleLayout(), browser: { url: "not a url" } }), /not a valid URL/);
});

test("store refuses an autosave that names a stale updatedAt and returns the current copy", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-layouts-"));
  try {
    const store = createLayoutStore(path.join(dir, "layouts.json"));
    const first = await store.upsert({ name: "shared", ...sampleLayout() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await store.upsert({ id: first.id, name: "shared", ...sampleLayout(), browser: { url: "https://example.com" } }, first.updatedAt);
    assert.notEqual(second.updatedAt, first.updatedAt);
    await assert.rejects(
      store.upsert({ id: first.id, name: "shared", ...sampleLayout() }, first.updatedAt),
      (error) => error.statusCode === 409 && error.layout.browser.url === "https://example.com"
    );
    // Without an expectation the write goes through, as a manual save does.
    const third = await store.upsert({ id: first.id, name: "renamed", ...sampleLayout() });
    assert.equal(third.name, "renamed");
    assert.deepEqual((await store.list()).map((item) => item.name), ["renamed"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
