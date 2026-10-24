const crypto = require("crypto");
const zlib = require("zlib");

// Bodies smaller than this are not worth the gzip framing overhead.
const MIN_GZIP_BYTES = 1024;

function acceptsGzip(request) {
  const header = String(request?.headers?.["accept-encoding"] || "");
  return /\bgzip\b/i.test(header);
}

function isCompressibleType(contentType) {
  const type = String(contentType || "").toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("svg")
  );
}

function encodeBody(request, body, contentType) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || "", "utf8");

  if (buffer.length < MIN_GZIP_BYTES || !isCompressibleType(contentType) || !acceptsGzip(request)) {
    return { body: buffer, headers: {} };
  }

  return {
    body: zlib.gzipSync(buffer, { level: 6 }),
    headers: { "Content-Encoding": "gzip", Vary: "Accept-Encoding" }
  };
}

function createEtag(buffer) {
  return `"${crypto.createHash("sha1").update(buffer).digest("base64url").slice(0, 27)}"`;
}

function isFresh(request, etag) {
  const header = String(request?.headers?.["if-none-match"] || "");
  return header.split(",").some((value) => value.trim().replace(/^W\//, "") === etag);
}

function hashText(text) {
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("base64url").slice(0, 22);
}

module.exports = {
  MIN_GZIP_BYTES,
  acceptsGzip,
  createEtag,
  encodeBody,
  hashText,
  isCompressibleType,
  isFresh
};
