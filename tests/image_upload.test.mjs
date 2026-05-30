import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import imageUpload from "../server/image_upload.js";

const {
  createComposerImageText,
  createMarkdownImageReference,
  decodeImageBase64,
  getLocalUploadRoot,
  IMAGE_UPLOAD_DIR_ENV,
  sanitizeFilename,
  uploadImageToTarget
} = imageUpload;

test("image upload helpers sanitize names and create markdown references", () => {
  assert.equal(sanitizeFilename("../my plot [draft].png"), "my-plot-draft.png");
  assert.equal(
    createMarkdownImageReference("my plot [draft].png", "file:///tmp/my%20plot.png"),
    "![my-plot-draft.png](file:///tmp/my%20plot.png)"
  );
  assert.equal(
    createComposerImageText({
      text: "please inspect this",
      fileName: "plot.png",
      fileUrl: "file:///tmp/plot.png"
    }),
    "please inspect this\n\n![plot.png](file:///tmp/plot.png)"
  );
});

test("image upload helpers decode data URLs", () => {
  const dataUrl = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;
  assert.equal(decodeImageBase64(dataUrl).toString("utf8"), "png-bytes");
});

test("local image uploads use the configured user-visible root", async (t) => {
  const previousRoot = process.env[IMAGE_UPLOAD_DIR_ENV];
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kitty-remote-deck-upload-"));
  const uploadRoot = path.join(tempRoot, "Pictures", "voxpress");

  t.after(async () => {
    if (previousRoot === undefined) {
      delete process.env[IMAGE_UPLOAD_DIR_ENV];
    } else {
      process.env[IMAGE_UPLOAD_DIR_ENV] = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  process.env[IMAGE_UPLOAD_DIR_ENV] = uploadRoot;

  assert.equal(getLocalUploadRoot(), uploadRoot);

  const result = await uploadImageToTarget(
    { transport: "local" },
    {
      imageBase64: Buffer.from("png-bytes").toString("base64"),
      fileName: "../screen shot.png",
      mimeType: "image/png"
    }
  );

  assert.ok(result.path.startsWith(`${uploadRoot}${path.sep}`));
  assert.match(path.basename(result.path), /^\d{14}-[a-z0-9]{6}-screen-shot\.png$/);
  assert.equal(await fs.readFile(result.path, "utf8"), "png-bytes");
  assert.ok(result.fileUrl.startsWith("file://"));
});
