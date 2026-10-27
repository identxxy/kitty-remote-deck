import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// app.js is one classic script: a second top-level declaration of the same
// name silently replaces the first, which is how a stale copy of a function
// once overrode its rewrite. Keep every top-level name unique.
test("app.js declares each top-level name once", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const names = [...source.matchAll(/^(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]);
  const seen = new Set();
  const duplicates = names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
  assert.deepEqual(duplicates, []);
  assert.ok(names.length > 200, `expected a full parse, saw ${names.length} declarations`);
});

test("index.html loads every module app.js reads from window", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const globals = [...source.matchAll(/window\.(KRD\w+)/g)].map((match) => match[1]);
  const loaded = [...html.matchAll(/<script src="\/modules\/([\w-]+)\.js\?v=[^"]+"><\/script>/g)].map((match) => match[1]);
  for (const name of new Set(globals)) {
    const file = name.replace(/^KRD/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    assert.ok(loaded.includes(file), `${name} needs /modules/${file}.js in index.html`);
  }
});
