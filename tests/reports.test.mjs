import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import reports from "../server/reports.js";

const { createReportStore } = reports;

test("report store records visits once per target and url, pins first, removes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-reports-"));
  try {
    const store = createReportStore(path.join(dir, "reports.json"));
    assert.deepEqual(await store.list(), []);
    const first = await store.record({ targetId: "mc-tmux", url: "file:///tmp/a.html#top", title: "  A  report " });
    assert.equal(first.url, "file:///tmp/a.html");
    assert.equal(first.title, "A report");
    const second = await store.record({ targetId: "mc-tmux", url: "file:///tmp/b.html", title: "B" });
    const again = await store.record({ targetId: "mc-tmux", url: "file:///tmp/a.html", title: "A renamed" });
    assert.equal(again.id, first.id);
    assert.equal((await store.list()).length, 2);
    // Most recently opened first.
    assert.deepEqual((await store.list()).map((item) => item.title), ["A renamed", "B"]);
    await store.update(second.id, { pinned: true });
    assert.deepEqual((await store.list()).map((item) => item.title), ["B", "A renamed"]);
    await assert.rejects(store.record({ targetId: "mc-tmux", url: "ftp://x/y" }), /Only http/);
    await assert.rejects(store.record({ targetId: "", url: "file:///x" }), /targetId/);
    await store.remove(first.id);
    assert.deepEqual((await store.list()).map((item) => item.id), [second.id]);
    await assert.rejects(store.remove("missing"), /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent records never corrupt the file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-reports-race-"));
  try {
    const store = createReportStore(path.join(dir, "reports.json"));
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.record({ targetId: "t", url: `file:///tmp/${index % 4}.html`, title: `title ${index}` })
      )
    );
    const listed = await store.list();
    assert.equal(listed.length, 4);
    assert.ok(listed.every((item) => /^title \d+$/.test(item.title)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
