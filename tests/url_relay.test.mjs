import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function runHelper(action, payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["server/remote_helper.py", action, encoded], {
      cwd: path.join(import.meta.dirname, "..")
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `helper exited with ${code}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test("remote helper fetches a file URL as HTML preview content", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-url-relay-"));
  const htmlPath = path.join(dir, "preview.html");
  const html = "<!doctype html><title>Preview</title><main>hello url relay</main>";
  await writeFile(htmlPath, html, "utf8");

  try {
    const result = await runHelper("fetch_url", {
      url: `file://${htmlPath}`
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.url, `file://${htmlPath}`);
    assert.equal(result.data.contentType, "text/html");
    assert.equal(result.data.body, html);
    assert.equal(result.data.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote helper fetches file URL byte ranges for media preview", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-url-range-"));
  const mediaPath = path.join(dir, "demo.mp4");
  const media = Buffer.from(Array.from({ length: 1024 }, (_, index) => index % 256));
  await writeFile(mediaPath, media);

  try {
    const result = await runHelper("fetch_url_resource", {
      url: `file://${mediaPath}`,
      range: "bytes=100-199"
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.statusCode, 206);
    assert.equal(result.data.contentType, "video/mp4");
    assert.equal(result.data.contentRange, "bytes 100-199/1024");
    assert.equal(result.data.acceptRanges, "bytes");
    assert.equal(result.data.byteLength, 100);
    assert.deepEqual(Buffer.from(result.data.bodyBase64, "base64"), media.subarray(100, 200));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
