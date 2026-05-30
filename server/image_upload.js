const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_UPLOAD_DIR_ENV = "KRD_IMAGE_UPLOAD_DIR";
const DEFAULT_IMAGE_UPLOAD_SUBDIR = path.join("Pictures", "voxpress");
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"]
]);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function sanitizeFilename(value) {
  const basename = path.basename(String(value || "image"));
  const ext = path.extname(basename).toLowerCase().replace(/[^.\w]+/g, "");
  const stem = basename.slice(0, ext ? -ext.length : undefined) || "image";
  const cleanedStem = stem
    .normalize("NFKD")
    .replace(/[^\w .-]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return `${cleanedStem || "image"}${ext}`;
}

function safeAltText(fileName) {
  return sanitizeFilename(fileName).replace(/[\[\]\n\r]/g, "-");
}

function extensionForImage(mimeType, filename) {
  const normalizedType = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const mapped = ALLOWED_IMAGE_TYPES.get(normalizedType);
  if (mapped) {
    return mapped;
  }

  const ext = path.extname(sanitizeFilename(filename)).toLowerCase();
  if ([...ALLOWED_IMAGE_TYPES.values()].includes(ext)) {
    return ext;
  }

  throw new Error("Unsupported image type. Use PNG, JPEG, WebP, GIF, HEIC, or HEIF.");
}

function decodeImageBase64(imageBase64) {
  const raw = String(imageBase64 || "").trim();
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/i);
  const base64Text = match ? match[2] : raw;
  const buffer = Buffer.from(base64Text, "base64");

  if (!buffer.length) {
    throw new Error("Image payload is empty.");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large. Limit is ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MiB.`);
  }

  return buffer;
}

function createUploadName(fileName, mimeType) {
  const safeName = sanitizeFilename(fileName);
  const stem = safeName.replace(/\.[^.]+$/, "") || "image";
  const ext = extensionForImage(mimeType, safeName);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${nonce}-${stem}${ext}`;
}

function createMarkdownImageReference(fileName, fileUrl) {
  return `![${safeAltText(fileName)}](${fileUrl})`;
}

function createComposerImageText({ text = "", fileName, fileUrl }) {
  const trimmedText = String(text || "").trimEnd();
  const imageRef = createMarkdownImageReference(fileName, fileUrl);
  return trimmedText ? `${trimmedText}\n\n${imageRef}` : imageRef;
}

function getUploadDate() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function expandHomePath(value, homeDir = os.homedir()) {
  const raw = String(value || "").trim();
  if (raw === "~") {
    return homeDir;
  }
  if (raw.startsWith("~/")) {
    return path.join(homeDir, raw.slice(2));
  }
  return raw;
}

function getLocalUploadRoot() {
  const configured = process.env[IMAGE_UPLOAD_DIR_ENV] || "";
  const expanded = expandHomePath(configured);
  return expanded ? path.resolve(expanded) : path.join(os.homedir(), DEFAULT_IMAGE_UPLOAD_SUBDIR);
}

async function uploadLocalImage(buffer, fileName, mimeType) {
  const uploadName = createUploadName(fileName, mimeType);
  const dir = path.join(getLocalUploadRoot(), getUploadDate());
  const filePath = path.join(dir, uploadName);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsp.writeFile(filePath, buffer, { mode: 0o600 });
  return {
    path: filePath,
    fileUrl: pathToFileURL(filePath).href,
    fileName: uploadName,
    byteLength: buffer.length,
    mimeType
  };
}

function runSshUpload(target, buffer, fileName, mimeType) {
  const uploadName = createUploadName(fileName, mimeType);
  const remoteScript = `
import json
import os
import sys
from urllib.parse import quote

upload_name = sys.argv[1]
mime_type = sys.argv[2]
max_bytes = int(sys.argv[3])
data = sys.stdin.buffer.read(max_bytes + 1)
if len(data) > max_bytes:
    raise SystemExit("Image is too large.")
upload_root = os.environ.get("KRD_IMAGE_UPLOAD_DIR", "").strip()
if not upload_root:
    upload_root = os.path.join(os.path.expanduser("~"), "Pictures", "voxpress")
else:
    upload_root = os.path.expanduser(upload_root)
root = os.path.join(upload_root, os.environ.get("KRD_UPLOAD_DATE", ""))
os.makedirs(root, mode=0o700, exist_ok=True)
path = os.path.join(root, upload_name)
with open(path, "wb") as handle:
    handle.write(data)
os.chmod(path, 0o600)
file_url = "file://" + quote(path)
print(json.dumps({"path": path, "fileUrl": file_url, "fileName": upload_name, "byteLength": len(data), "mimeType": mime_type}))
`.trim();

  const envAssignments = [
    `KRD_UPLOAD_DATE=${shellQuote(getUploadDate())}`
  ];
  if (process.env[IMAGE_UPLOAD_DIR_ENV]) {
    envAssignments.push(`${IMAGE_UPLOAD_DIR_ENV}=${shellQuote(process.env[IMAGE_UPLOAD_DIR_ENV])}`);
  }

  const remoteCommand = [
    ...envAssignments,
    "python3",
    "-c",
    shellQuote(remoteScript),
    shellQuote(uploadName),
    shellQuote(mimeType),
    String(MAX_IMAGE_BYTES)
  ].join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [target.sshTarget, remoteCommand], {
      windowsHide: true
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
        reject(new Error(stderr.trim() || stdout.trim() || `ssh upload exited with code ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Unexpected ssh upload response: ${stdout.trim() || "<empty>"}`));
      }
    });

    child.stdin.end(buffer);
  });
}

async function uploadImageToTarget(target, image) {
  const mimeType = String(image.mimeType || image.contentType || "").split(";")[0].trim().toLowerCase();
  const buffer = decodeImageBase64(image.imageBase64 || image.dataBase64 || image.dataUrl || "");
  const fileName = sanitizeFilename(image.fileName || image.name || "image");
  extensionForImage(mimeType, fileName);

  if (target.transport === "ssh") {
    return runSshUpload(target, buffer, fileName, mimeType);
  }

  return uploadLocalImage(buffer, fileName, mimeType);
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_IMAGE_UPLOAD_SUBDIR,
  IMAGE_UPLOAD_DIR_ENV,
  MAX_IMAGE_BYTES,
  createComposerImageText,
  createMarkdownImageReference,
  decodeImageBase64,
  getLocalUploadRoot,
  sanitizeFilename,
  uploadImageToTarget
};
