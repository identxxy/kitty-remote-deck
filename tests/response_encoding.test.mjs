import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";

import encoding from "../server/response_encoding.js";

const {
  MIN_GZIP_BYTES,
  acceptsGzip,
  createEtag,
  encodeBody,
  hashText,
  isFresh
} = encoding;

const gzipRequest = { headers: { "accept-encoding": "gzip, deflate, br" } };
const plainRequest = { headers: {} };

test("gzip is only used when the client accepts it", () => {
  assert.equal(acceptsGzip(gzipRequest), true);
  assert.equal(acceptsGzip(plainRequest), false);
  assert.equal(acceptsGzip(undefined), false);
});

test("large text bodies are gzipped and round-trip intact", () => {
  const body = JSON.stringify({ text: "x".repeat(MIN_GZIP_BYTES * 4) });
  const encoded = encodeBody(gzipRequest, body, "application/json; charset=utf-8");

  assert.equal(encoded.headers["Content-Encoding"], "gzip");
  assert.ok(encoded.body.length < body.length);
  assert.equal(zlib.gunzipSync(encoded.body).toString("utf8"), body);
});

test("small, binary, or non-gzip responses are sent as-is", () => {
  const large = "y".repeat(MIN_GZIP_BYTES * 2);

  assert.deepEqual(encodeBody(gzipRequest, "{}", "application/json").headers, {});
  assert.deepEqual(encodeBody(gzipRequest, large, "image/png").headers, {});
  assert.deepEqual(encodeBody(plainRequest, large, "text/css").headers, {});
  assert.equal(encodeBody(plainRequest, large, "text/css").body.toString("utf8"), large);
});

test("etags match If-None-Match, including weak and listed values", () => {
  const etag = createEtag(Buffer.from("hello"));

  assert.equal(etag, createEtag(Buffer.from("hello")));
  assert.notEqual(etag, createEtag(Buffer.from("hello!")));
  assert.equal(isFresh({ headers: { "if-none-match": etag } }, etag), true);
  assert.equal(isFresh({ headers: { "if-none-match": `W/${etag}` } }, etag), true);
  assert.equal(isFresh({ headers: { "if-none-match": `"other", ${etag}` } }, etag), true);
  assert.equal(isFresh({ headers: { "if-none-match": '"other"' } }, etag), false);
  assert.equal(isFresh(plainRequest, etag), false);
});

test("screen hashes are stable and change with content", () => {
  assert.equal(hashText("abc"), hashText("abc"));
  assert.notEqual(hashText("abc"), hashText("abd"));
  assert.equal(hashText(undefined), hashText(""));
});
