const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL, fileURLToPath } = require("url");
const {
  authenticateSession,
  clearSession,
  createAuthManager,
  serializeClearCookie,
  serializeSessionCookie,
  verifyDeviceToken
} = require("./server/auth");
const { normalizeBackend, normalizeTransport, runKittyAction } = require("./server/kitty_runner");
const {
  createProxyUrl,
  isCssContentType,
  isHtmlContentType,
  rewriteCssResources,
  rewriteHtmlResources,
  parseProxyPath
} = require("./server/url_proxy");
const { createEtag, encodeBody, hashText, isFresh } = require("./server/response_encoding");
const { WatcherRegistry, controlClientArgv } = require("./server/tmux_watcher");
const { createLayoutStore } = require("./server/layouts");
const { createReportStore } = require("./server/reports");
const { splitLines, computeLineDelta } = require("./public/modules/terminal-lines");
const {
  MAX_IMAGE_BYTES,
  createComposerImageText,
  uploadImageToTarget
} = require("./server/image_upload");

const PORT = Number(process.env.PORT || 3040);
const HOST = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const TMP_DIR = path.join(ROOT_DIR, "tmp");
const TARGETS_FILE = path.join(DATA_DIR, "targets.json");
const LAYOUTS_FILE = path.join(DATA_DIR, "layouts.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const layoutStore = createLayoutStore(LAYOUTS_FILE);
const reportStore = createReportStore(REPORTS_FILE);
const AUTH_FILE = process.env.KRD_AUTH_FILE || path.join(DATA_DIR, "auth.json");
const CLIENT_DEBUG_LOG_FILE = path.join(TMP_DIR, "client-debug.log");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const REMOTE_HELPER_PATH = path.join(ROOT_DIR, "server", "remote_helper.py");
const MAX_IMAGE_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES * 1.6);
const PREVIEW_ACCESS_TTL_MS = Number(process.env.KRD_PREVIEW_ACCESS_TTL_MS || 2 * 60 * 60 * 1000);
const previewAccessSecret = crypto.randomBytes(32);
const authManager = createAuthManager(AUTH_FILE);

const DEFAULT_TARGET = {
  id: "local",
  name: "Local Kitty",
  transport: "local",
  backend: "kitty",
  sshTarget: "",
  kittyBinary: "kitty",
  tmuxBinary: "tmux",
  socketPattern: "/tmp/kitty.sock-*",
  defaultSocket: "",
  notes: "Local GUI kitty session on this machine"
};

// tmux has no per-viewer viewport, so Screen-mode scrolling keeps an offset per
// pane here and the helper captures the matching slice of history.
const tmuxScrollOffsets = new Map();
const MAX_EVENT_SUBSCRIPTIONS = 8;
// Last text served per pane/extent, so a poller holding that text can get a
// line delta instead of the whole scrollback.
const SCREEN_CACHE_LIMIT = 64;
const screenTextCache = new Map();

function rememberScreenText(key, hash, text) {
  screenTextCache.delete(key);
  screenTextCache.set(key, { hash, text });
  while (screenTextCache.size > SCREEN_CACHE_LIMIT) {
    screenTextCache.delete(screenTextCache.keys().next().value);
  }
}

function describeScreenDelta(previousText, text) {
  const oldLines = splitLines(previousText);
  const newLines = splitLines(text);
  const delta = computeLineDelta(oldLines, newLines);
  const tailBytes = delta.tail.reduce((sum, line) => sum + line.length + 1, 0);
  if (delta.keep === 0 || tailBytes > text.length * 0.6) {
    return null;
  }
  return delta;
}
const EVENT_HEARTBEAT_MS = 20000;
const watcherRegistry = new WatcherRegistry();

function scrollOffsetKey(target, socket, windowId) {
  return `${target.id}|${socket || ""}|${windowId}`;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  // Served through the Browser proxy for local files: module scripts and
  // data files need their real types or the page refuses them.
  ".mjs": "application/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const RESOURCE_MIME_TYPES = {
  ...MIME_TYPES,
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".ogg": "video/ogg",
  ".ogv": "video/ogg",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

let remoteHelperSource = "";

function createId() {
  return `target-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTarget(input, fallbackId) {
  const transport = normalizeTransport(input.transport || (input.sshTarget ? "ssh" : "local"));
  const backend = normalizeBackend(input.backend);
  const target = {
    id: String(input.id || fallbackId || createId()).trim(),
    name: String(input.name || "").trim(),
    transport,
    backend,
    sshTarget: String(input.sshTarget || "").trim(),
    kittyBinary: String(input.kittyBinary || DEFAULT_TARGET.kittyBinary).trim(),
    tmuxBinary: String(input.tmuxBinary || DEFAULT_TARGET.tmuxBinary).trim(),
    // An empty tmux pattern means the helper derives $TMUX_TMPDIR/tmux-UID/* on the target.
    socketPattern: String(input.socketPattern || (backend === "tmux" ? "" : DEFAULT_TARGET.socketPattern)).trim(),
    defaultSocket: String(input.defaultSocket || "").trim(),
    notes: String(input.notes || "").trim(),
    createdAt: input.createdAt || undefined,
    updatedAt: input.updatedAt || undefined
  };

  if (!target.name) {
    throw new Error("Target name is required.");
  }

  if (target.transport === "ssh" && !target.sshTarget) {
    throw new Error("SSH target is required.");
  }

  return target;
}

async function ensureDataStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  try {
    await fsp.access(TARGETS_FILE, fs.constants.F_OK);
  } catch (error) {
    const seeded = {
      lastSelectedTargetId: DEFAULT_TARGET.id,
      targets: [
        {
          ...DEFAULT_TARGET,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ]
    };

    await fsp.writeFile(TARGETS_FILE, JSON.stringify(seeded, null, 2));
    return;
  }

  const raw = await fsp.readFile(TARGETS_FILE, "utf8");
  const store = JSON.parse(raw);
  const targets = (store.targets || []).map((target) => normalizeTarget(target, target.id));
  const hasLocalTarget = targets.some((target) => target.transport === "local");

  if (!hasLocalTarget) {
    const localTarget = {
      ...DEFAULT_TARGET,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    targets.unshift(localTarget);
    store.targets = targets;
    store.lastSelectedTargetId = localTarget.id;
    await fsp.writeFile(TARGETS_FILE, JSON.stringify(store, null, 2));
  }
}

async function readStore() {
  await ensureDataStore();
  const raw = await fsp.readFile(TARGETS_FILE, "utf8");
  const store = JSON.parse(raw);
  return {
    ...store,
    targets: (store.targets || []).map((target) => normalizeTarget(target, target.id))
  };
}

async function writeStore(store) {
  await fsp.writeFile(TARGETS_FILE, JSON.stringify(store, null, 2));
}

function sendJson(response, statusCode, payload) {
  sendJsonWithHeaders(response, statusCode, payload);
}

function sendJsonWithHeaders(response, statusCode, payload, headers = {}) {
  const contentType = "application/json; charset=utf-8";
  const encoded = encodeBody(response.req, JSON.stringify(payload), contentType);
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...encoded.headers,
    ...headers
  });
  response.end(encoded.body);
}

function sendText(response, statusCode, payload, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function sendBuffer(response, statusCode, buffer, contentType, headers = {}) {
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  response.writeHead(statusCode, {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(payload);
}

function sendStream(response, statusCode, stream, contentType, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  stream.on("error", (error) => response.destroy(error));
  stream.pipe(response);
}

async function appendClientDebugLog(payload, request) {
  const payloadText = JSON.stringify(payload || {});
  const entry = {
    at: nowIso(),
    ip: request.headers["cf-connecting-ip"] || request.socket.remoteAddress || "",
    userAgent: request.headers["user-agent"] || "",
    payload: payloadText.length > 18000
      ? { truncated: true, text: payloadText.slice(0, 18000) }
      : payload
  };

  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.appendFile(CLIENT_DEBUG_LOG_FILE, `${JSON.stringify(entry)}\n`);
}

async function parseRequestBody(request, options = {}) {
  const chunks = [];
  let totalBytes = 0;
  const maxBytes = options.maxBytes || 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (maxBytes && totalBytes > maxBytes) {
      throw new Error(`Request body is too large. Limit is ${Math.floor(maxBytes / 1024 / 1024)} MiB.`);
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Request body must be valid JSON.");
  }
}

// tmux ids start at 0 (%0, @0, $0); kitty ids start at 1.
function parsePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return number;
}

function parseOptionalPositiveInteger(value, name) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parsePositiveInteger(value, name);
}

function parseWindowId(value) {
  return parsePositiveInteger(value, "windowId");
}

function parseCreatePanelKind(value) {
  const kind = String(value || "window").trim().toLowerCase();
  if (!["window", "tab", "split"].includes(kind)) {
    throw new Error("kind must be one of: window, tab, split.");
  }
  return kind;
}

function parseScrollLines(value) {
  const lines = Number(value);
  if (!Number.isInteger(lines)) {
    throw new Error("lines must be an integer.");
  }
  return Math.max(-120, Math.min(120, lines));
}

function shouldUseSecureCookie(request) {
  const forced = process.env.KRD_COOKIE_SECURE;

  if (forced === "1") {
    return true;
  }

  if (forced === "0") {
    return false;
  }

  const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto === "https";
}

async function authenticateRequest(request) {
  return authenticateSession(authManager, request.headers.cookie || "");
}

function sendUnauthorized(response) {
  sendJson(response, 401, { error: "Authentication required." });
}

async function resolveTargetFromRequest(bodyOrQuery) {
  const store = await readStore();
  const targetId = bodyOrQuery.targetId || bodyOrQuery.id;

  if (targetId) {
    const matched = store.targets.find((target) => target.id === targetId);

    if (!matched) {
      throw new Error(`Target "${targetId}" was not found.`);
    }

    return matched;
  }

  if (bodyOrQuery.target) {
    return normalizeTarget(bodyOrQuery.target);
  }

  throw new Error("A targetId or target payload is required.");
}

function parseEventSubscriptions(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch (error) {
    throw new Error("subs must be JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("subs must be an array.");
  }
  const seen = new Set();
  const subs = [];
  for (const item of parsed.slice(0, MAX_EVENT_SUBSCRIPTIONS)) {
    const targetId = String(item?.targetId || "");
    const socket = String(item?.socket || "");
    const windowId = parseWindowId(item?.windowId);
    const key = `${targetId}|${socket}|${windowId}`;
    if (targetId && !seen.has(key)) {
      seen.add(key);
      subs.push({ targetId, socket, windowId, key });
    }
  }
  return subs;
}

// Server-sent events: `screen` when a subscribed pane's tmux window changes,
// `tree` when sessions/windows change, `reset` when a watcher dies. Each
// subscription is a deck pane (tmux pane id) on a tmux target.
async function handleEventStream(request, response, requestUrl) {
  const subs = parseEventSubscriptions(requestUrl.searchParams.get("subs"));
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 5000\n\n");

  const send = (event, payload) => {
    if (!response.writableEnded) {
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  };
  const held = [];
  let closed = false;
  const releaseAll = () => {
    for (const entry of held.splice(0)) {
      entry.watcher.off("change", entry.onChange);
      entry.watcher.off("exit", entry.onExit);
      entry.watcher.release();
    }
  };
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(": ping\n\n");
    }
  }, EVENT_HEARTBEAT_MS);
  const cleanup = () => {
    closed = true;
    clearInterval(heartbeat);
    releaseAll();
  };
  request.on("close", cleanup);

  const live = [];
  const unsupported = [];
  for (const sub of subs) {
    try {
      const target = await resolveTargetFromRequest({ targetId: sub.targetId });
      if (normalizeBackend(target.backend) !== "tmux") {
        unsupported.push({ key: sub.key, reason: "kitty targets poll" });
        continue;
      }
      const description = await runRemoteKittyAction(target, "describe_window", { socket: sub.socket, windowId: sub.windowId }, 15000);
      if (closed) {
        return;
      }
      const watcherKey = `${target.id}|${description.socket}|${description.sessionId}`;
      const watcher = watcherRegistry.get(watcherKey, () => controlClientArgv(target, description));
      watcher.acquire();
      const onChange = (change) => {
        if (watcher.concerns(change, sub.windowId)) {
          send("screen", { key: sub.key, targetId: sub.targetId, socket: sub.socket, windowId: sub.windowId });
        }
        if (change.structure) {
          send("tree", { key: sub.key, targetId: sub.targetId });
        }
      };
      const onExit = (error) => {
        send("reset", { key: sub.key, reason: error || "tmux control client exited" });
        cleanup();
        response.end();
      };
      watcher.on("change", onChange);
      watcher.on("exit", onExit);
      held.push({ watcher, onChange, onExit });
      live.push({ key: sub.key, targetId: sub.targetId, socket: sub.socket, windowId: sub.windowId, session: description.sessionName });
    } catch (error) {
      unsupported.push({ key: sub.key, reason: error.message });
    }
  }
  if (closed) {
    releaseAll();
    return;
  }
  send("subscribed", { live, unsupported });
}

async function runRemoteKittyAction(target, action, payload, timeoutMs) {
  return runKittyAction(target, action, payload, {
    cwd: ROOT_DIR,
    helperSource: remoteHelperSource,
    timeoutMs: timeoutMs || 20000
  });
}

function decodeFetchedResource(data) {
  if (data.bodyBase64) {
    return Buffer.from(data.bodyBase64, "base64");
  }

  return Buffer.from(String(data.body || ""), data.encoding || "utf8");
}

function transformFetchedResource(data, targetId, accessToken = "") {
  const contentType = data.contentType || "application/octet-stream";
  const finalUrl = data.finalUrl || data.url;
  const rawBuffer = decodeFetchedResource(data);

  if (isHtmlContentType(contentType)) {
    const html = typeof data.body === "string" ? data.body : rawBuffer.toString(data.encoding || "utf8");
    return {
      buffer: Buffer.from(rewriteHtmlResources(html, finalUrl, targetId, { accessToken }), data.encoding || "utf8"),
      contentType
    };
  }

  if (isCssContentType(contentType)) {
    const css = typeof data.body === "string" ? data.body : rawBuffer.toString(data.encoding || "utf8");
    return {
      buffer: Buffer.from(rewriteCssResources(css, finalUrl, targetId, { accessToken }), data.encoding || "utf8"),
      contentType
    };
  }

  return {
    buffer: rawBuffer,
    contentType
  };
}

function guessResourceContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return RESOURCE_MIME_TYPES[ext] || "application/octet-stream";
}

function browserResourceHeaders(data, url, extraHeaders = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, X-KRD-Final-URL, X-KRD-Truncated",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Timing-Allow-Origin": "*",
    "X-KRD-Final-URL": encodeURIComponent(data.finalUrl || data.url || url),
    "X-KRD-Truncated": data.truncated ? "1" : "0",
    ...extraHeaders
  };
}

function filePathFromLocalFileUrl(url) {
  const parsed = new URL(url);

  if (parsed.protocol !== "file:") {
    return "";
  }

  if (parsed.hostname && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error("file:// URLs must point to the selected host.");
  }

  if (parsed.hostname === "127.0.0.1") {
    parsed.host = "";
  }

  return fileURLToPath(parsed);
}

function parseByteRange(rangeHeader, size) {
  const match = String(rangeHeader || "").match(/^bytes=(\d*)-(\d*)$/);

  if (!match || !Number.isSafeInteger(size) || size < 1) {
    return null;
  }

  const [, startText, endText] = match;
  let start;
  let end;

  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function previewAccessSignature(payloadText) {
  return crypto
    .createHmac("sha256", previewAccessSecret)
    .update(payloadText)
    .digest("base64url");
}

function normalizePreviewAccessUrl(rawUrl) {
  const parsed = new URL(rawUrl);

  if (!["file:", "http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only file://, http://, and https:// URLs are supported.");
  }

  return parsed.href;
}

function previewAccessScopeForUrl(rawUrl) {
  const parsed = new URL(normalizePreviewAccessUrl(rawUrl));
  const pathname = parsed.pathname || "/";
  const prefixEnd = pathname.endsWith("/") ? pathname.length : pathname.lastIndexOf("/") + 1;
  parsed.pathname = pathname.slice(0, Math.max(1, prefixEnd));
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

function createPreviewAccessToken(targetId, rawUrl) {
  const expiresAt = Date.now() + PREVIEW_ACCESS_TTL_MS;
  const payload = {
    targetId: String(targetId || ""),
    urlPrefix: previewAccessScopeForUrl(rawUrl),
    expiresAt
  };
  const payloadText = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = previewAccessSignature(payloadText);

  return {
    accessToken: `${payloadText}.${signature}`,
    expiresAt: new Date(expiresAt).toISOString(),
    urlPrefix: payload.urlPrefix
  };
}

function verifyPreviewAccessToken(accessToken, targetId, rawUrl) {
  const [payloadText, signature, ...extra] = String(accessToken || "").split(".");

  if (!payloadText || !signature || extra.length) {
    return false;
  }

  const expectedSignature = previewAccessSignature(payloadText);
  if (!safeEqualText(signature, expectedSignature)) {
    return false;
  }

  let payload;

  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch (error) {
    return false;
  }

  if (
    payload.targetId !== String(targetId || "") ||
    !payload.urlPrefix ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt < Date.now()
  ) {
    return false;
  }

  try {
    return normalizePreviewAccessUrl(rawUrl).startsWith(payload.urlPrefix);
  } catch (error) {
    return false;
  }
}

// The proxied resource a request names, in either URL form.
function proxiedResourceFromRequest(requestUrl) {
  if (requestUrl.pathname === "/api/url-resource") {
    return {
      targetId: requestUrl.searchParams.get("targetId") || "",
      url: requestUrl.searchParams.get("url") || "",
      accessToken: requestUrl.searchParams.get("access") || ""
    };
  }
  return parseProxyPath(requestUrl.pathname, requestUrl.search);
}

function hasPreviewResourceAccess(requestUrl) {
  const resource = proxiedResourceFromRequest(requestUrl);
  if (!resource) {
    return false;
  }
  return verifyPreviewAccessToken(resource.accessToken, resource.targetId, resource.url);
}

function sendRangeNotSatisfiable(response, size, data) {
  sendBuffer(response, 416, Buffer.alloc(0), "application/octet-stream", browserResourceHeaders(data, data.url, {
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes */${size}`
  }));
}

async function serveLocalFileResource(request, response, target, url, accessToken = "") {
  if (normalizeTransport(target.transport) !== "local") {
    return false;
  }

  let filePath;

  try {
    filePath = filePathFromLocalFileUrl(url);
  } catch (error) {
    throw error;
  }

  if (!filePath) {
    return false;
  }

  let stat;

  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    sendText(response, 404, "File not found.");
    return true;
  }

  if (stat.isDirectory()) {
    // The helper renders directory listings for every transport.
    return false;
  }

  if (!stat.isFile()) {
    sendText(response, 403, "Only regular files can be previewed.");
    return true;
  }

  const contentType = guessResourceContentType(filePath);
  const data = { url, finalUrl: url, truncated: false };
  const commonHeaders = browserResourceHeaders(data, url, {
    "Accept-Ranges": "bytes"
  });
  const rangeHeader = request.headers.range || "";

  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, stat.size);

    if (!range) {
      sendRangeNotSatisfiable(response, stat.size, data);
      return true;
    }

    sendStream(
      response,
      206,
      fs.createReadStream(filePath, range),
      contentType,
      {
        ...commonHeaders,
        "Content-Length": range.end - range.start + 1,
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`
      }
    );
    return true;
  }

  if (isHtmlContentType(contentType) || isCssContentType(contentType)) {
    const rawBuffer = await fsp.readFile(filePath);
    const transformed = transformFetchedResource(
      {
        url,
        finalUrl: url,
        contentType,
        bodyBase64: rawBuffer.toString("base64"),
        body: rawBuffer.toString("utf8"),
        encoding: "utf8",
        truncated: false
      },
      target.id,
      accessToken
    );
    sendBuffer(response, 200, transformed.buffer, transformed.contentType, commonHeaders);
    return true;
  }

  sendStream(response, 200, fs.createReadStream(filePath), contentType, {
    ...commonHeaders,
    "Content-Length": stat.size
  });
  return true;
}

// Static assets revalidate on every load ("no-cache") so updates show up immediately,
// but an unchanged file costs only a 304 instead of a full download.
function sendStaticBuffer(request, response, file, contentType) {
  const etag = createEtag(file);
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    ETag: etag,
    Vary: "Accept-Encoding"
  };

  if (isFresh(request, etag)) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  const encoded = encodeBody(request, file, contentType);
  response.writeHead(200, { ...headers, ...encoded.headers });
  response.end(encoded.body);
}

async function serveStaticFile(request, requestPath, response) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const absolutePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fsp.readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    sendStaticBuffer(request, response, file, MIME_TYPES[ext] || "application/octet-stream");
  } catch (error) {
    const fallback = path.join(PUBLIC_DIR, "index.html");

    try {
      const file = await fsp.readFile(fallback);
      sendStaticBuffer(request, response, file, MIME_TYPES[".html"]);
    } catch (fallbackError) {
      sendText(response, 404, "Not found");
    }
  }
}

async function handleApi(request, response, requestUrl) {
  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, host: HOST, port: PORT });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/auth/status") {
      const auth = await authenticateRequest(request);
      sendJson(response, 200, {
        authenticated: Boolean(auth),
        device: auth?.device || null
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/auth/login") {
      const body = await parseRequestBody(request);
      const login = await verifyDeviceToken(authManager, body.token);
      sendJsonWithHeaders(
        response,
        200,
        {
          authenticated: true,
          device: login.device
        },
        {
          "Set-Cookie": serializeSessionCookie(login.sessionCookie, {
            secure: shouldUseSecureCookie(request)
          })
        }
      );
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
      await clearSession(authManager, request.headers.cookie || "");
      sendJsonWithHeaders(
        response,
        200,
        { authenticated: false },
        {
          "Set-Cookie": serializeClearCookie({
            secure: shouldUseSecureCookie(request)
          })
        }
      );
      return;
    }

    const resourceAccessAuthorized = request.method === "GET" && hasPreviewResourceAccess(requestUrl);
    const auth = resourceAccessAuthorized ? { previewResource: true } : await authenticateRequest(request);

    if (!auth) {
      sendUnauthorized(response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/client-log") {
      const body = await parseRequestBody(request);
      await appendClientDebugLog(body, request);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/url-access-token") {
      const target = await resolveTargetFromRequest({
        targetId: requestUrl.searchParams.get("targetId")
      });
      const url = requestUrl.searchParams.get("url") || "";

      if (!url) {
        throw new Error("URL is required.");
      }

      sendJson(response, 200, createPreviewAccessToken(target.id, url));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/targets") {
      const store = await readStore();
      sendJson(response, 200, store);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/targets") {
      const body = await parseRequestBody(request);
      const store = await readStore();
      const normalized = normalizeTarget(body.target || body, body.id);
      const existingIndex = store.targets.findIndex((item) => item.id === normalized.id);

      if (existingIndex >= 0) {
        store.targets[existingIndex] = {
          ...store.targets[existingIndex],
          ...normalized,
          updatedAt: nowIso()
        };
      } else {
        store.targets.push({
          ...normalized,
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      }

      store.lastSelectedTargetId = normalized.id;
      await writeStore(store);
      sendJson(response, 200, { target: normalized });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/targets/select") {
      const body = await parseRequestBody(request);
      const store = await readStore();
      const exists = store.targets.some((target) => target.id === body.targetId);

      if (!exists) {
        throw new Error("Target not found.");
      }

      store.lastSelectedTargetId = body.targetId;
      await writeStore(store);
      sendJson(response, 200, { ok: true });
      return;
    }

    // Layouts: named view layouts shared by every device of this deck.
    if (request.method === "GET" && requestUrl.pathname === "/api/reports") {
      sendJson(response, 200, { reports: await reportStore.list() });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/reports") {
      const body = await parseRequestBody(request);
      sendJson(response, 200, { report: await reportStore.record(body) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/reports/update") {
      const body = await parseRequestBody(request);
      sendJson(response, 200, { report: await reportStore.update(String(body.id || ""), body) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/reports/delete") {
      const body = await parseRequestBody(request);
      await reportStore.remove(String(body.id || ""));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/layouts") {
      sendJson(response, 200, { layouts: await layoutStore.list() });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/layouts") {
      const body = await parseRequestBody(request);
      const layout = await layoutStore.upsert(body.layout || body, String(body.expectedUpdatedAt || ""));
      sendJson(response, 200, { layout });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/layouts/delete") {
      const body = await parseRequestBody(request);
      await layoutStore.remove(String(body.id || ""));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/targets/test") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const data = await runRemoteKittyAction(target, "test", { socket: body.socket || "" }, 25000);
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/url-preview") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const data = await runRemoteKittyAction(
        target,
        "fetch_url",
        {
          url: String(body.url || "")
        },
        30000
      );
      sendJson(response, 200, {
        ...data,
        proxyUrl: createProxyUrl(data.finalUrl || data.url || String(body.url || ""), target.id)
      });
      return;
    }

    if (request.method === "GET" && proxiedResourceFromRequest(requestUrl)) {
      const { targetId, url, accessToken } = proxiedResourceFromRequest(requestUrl);
      const target = await resolveTargetFromRequest({ targetId });
      const servedLocalFile = await serveLocalFileResource(request, response, target, url, accessToken);

      if (servedLocalFile) {
        return;
      }

      const rangeHeader = request.headers.range || "";
      const data = await runRemoteKittyAction(
        target,
        rangeHeader ? "fetch_url_resource" : "fetch_url",
        {
          url,
          range: rangeHeader
        },
        45000
      );
      const transformed = rangeHeader
        ? { buffer: decodeFetchedResource(data), contentType: data.contentType || "application/octet-stream" }
        : transformFetchedResource(data, target.id, accessToken);
      const statusCode = Number(data.statusCode || 200);
      const headers = browserResourceHeaders(data, url, {
        "Accept-Ranges": data.acceptRanges || "bytes"
      });

      if (data.contentRange) {
        headers["Content-Range"] = data.contentRange;
      }

      sendBuffer(response, statusCode, transformed.buffer, transformed.contentType, headers);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/sessions") {
      const target = await resolveTargetFromRequest({
        targetId: requestUrl.searchParams.get("targetId")
      });
      const data = await runRemoteKittyAction(
        target,
        "list_sessions",
        { socket: requestUrl.searchParams.get("socket") || "" },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/events") {
      await handleEventStream(request, response, requestUrl);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/screen") {
      const target = await resolveTargetFromRequest({
        targetId: requestUrl.searchParams.get("targetId")
      });
      const windowId = parseWindowId(requestUrl.searchParams.get("windowId"));
      const socket = requestUrl.searchParams.get("socket") || "";

      const data = await runRemoteKittyAction(
        target,
        "get_screen",
        {
          socket,
          windowId,
          extent: requestUrl.searchParams.get("extent") === "all" ? "all" : "screen",
          scrollOffset: tmuxScrollOffsets.get(scrollOffsetKey(target, socket, windowId)) || 0
        },
        25000
      );
      // Let pollers skip re-downloading a screen they already have.
      const hash = hashText(data?.panes ? JSON.stringify(data.panes) : data?.text);
      const since = requestUrl.searchParams.get("since");
      if (since === hash) {
        sendJson(response, 200, { unchanged: true, hash });
        return;
      }
      if (!data?.panes && typeof data?.text === "string") {
        const cacheKey = `${scrollOffsetKey(target, socket, windowId)}|${requestUrl.searchParams.get("extent") === "all" ? "all" : "screen"}`;
        const cached = screenTextCache.get(cacheKey);
        rememberScreenText(cacheKey, hash, data.text);
        if (since && requestUrl.searchParams.get("delta") === "1" && cached && cached.hash === since) {
          const delta = describeScreenDelta(cached.text, data.text);
          if (delta) {
            const { text, ...rest } = data;
            sendJson(response, 200, { ...rest, delta: true, base: since, hash, drop: delta.drop, keep: delta.keep, tail: delta.tail });
            return;
          }
        }
      }
      sendJson(response, 200, { ...data, hash });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/send-text") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const windowId = parseWindowId(body.windowId);

      const data = await runRemoteKittyAction(
        target,
        "send_text",
        {
          socket: body.socket || "",
          windowId,
          text: String(body.text || ""),
          appendNewline: Boolean(body.appendNewline)
        },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/send-image") {
      const body = await parseRequestBody(request, { maxBytes: MAX_IMAGE_REQUEST_BYTES });
      const target = await resolveTargetFromRequest(body);
      const windowId = parseWindowId(body.windowId);
      const image = await uploadImageToTarget(target, {
        imageBase64: body.imageBase64 || body.dataUrl || "",
        fileName: body.fileName || "image",
        mimeType: body.mimeType || ""
      });
      const text = createComposerImageText({
        text: body.text || "",
        fileName: body.fileName || image.fileName,
        fileUrl: image.fileUrl
      });

      const data = await runRemoteKittyAction(
        target,
        "send_text",
        {
          socket: body.socket || "",
          windowId,
          text,
          appendNewline: Boolean(body.appendNewline)
        },
        25000
      );

      sendJson(response, 200, {
        ...data,
        image,
        sentTextLength: text.length + (body.appendNewline ? 1 : 0)
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/send-key") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const windowId = parseWindowId(body.windowId);

      // `keys` sends a chord (Ctrl+X Ctrl+S) in one round trip; `repeat` repeats one key.
      const keys = Array.isArray(body.keys)
        ? body.keys.slice(0, 8).map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const data = await runRemoteKittyAction(
        target,
        "send_key",
        {
          socket: body.socket || "",
          windowId,
          key: String(body.key || keys[0] || "enter"),
          keys,
          repeat: Math.max(1, Math.min(Number(body.repeat) || 1, 5))
        },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/scroll-window") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const windowId = parseWindowId(body.windowId);
      const toEnd = body.toEnd === true;
      const lines = toEnd ? 0 : parseScrollLines(body.lines);
      const offsetKey = scrollOffsetKey(target, body.socket || "", windowId);

      const data = await runRemoteKittyAction(
        target,
        "scroll_window",
        {
          socket: body.socket || "",
          windowId,
          lines,
          toEnd,
          scrollOffset: tmuxScrollOffsets.get(offsetKey) || 0
        },
        25000
      );
      if (typeof data.scrollOffset === "number") {
        if (data.scrollOffset > 0) {
          tmuxScrollOffsets.set(offsetKey, data.scrollOffset);
        } else {
          tmuxScrollOffsets.delete(offsetKey);
        }
      }
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/focus-window") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const windowId = parseWindowId(body.windowId);

      const data = await runRemoteKittyAction(
        target,
        "focus_window",
        {
          socket: body.socket || "",
          windowId
        },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/toggle-zoom") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      if (normalizeBackend(target.backend) !== "tmux") {
        throw new Error("Pane zoom is only supported for tmux targets.");
      }
      const data = await runRemoteKittyAction(
        target,
        "toggle_zoom",
        { socket: body.socket || "", windowId: parseWindowId(body.windowId) },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/close-panel") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const kind = String(body.kind || "");
      if (!["session", "tab", "pane"].includes(kind)) {
        throw new Error("kind must be session, tab, or pane.");
      }
      const data = await runRemoteKittyAction(
        target,
        "close_panel",
        { socket: body.socket || "", kind, id: parsePositiveInteger(body.id, "id") },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/resize-window") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      if (normalizeBackend(target.backend) !== "tmux") {
        throw new Error("Pane resize is only supported for tmux targets.");
      }
      const windowId = parseWindowId(body.windowId);

      const data = await runRemoteKittyAction(
        target,
        "resize_window",
        {
          socket: body.socket || "",
          windowId,
          columns: parsePositiveInteger(body.columns, "columns"),
          rows: parsePositiveInteger(body.rows, "rows"),
          force: body.force === true
        },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/create-panel") {
      const body = await parseRequestBody(request);
      const target = await resolveTargetFromRequest(body);
      const kind = parseCreatePanelKind(body.kind);

      const data = await runRemoteKittyAction(
        target,
        "create_panel",
        {
          socket: body.socket || "",
          kind,
          sourceWindowId: parseOptionalPositiveInteger(body.sourceWindowId, "sourceWindowId"),
          tabId: parseOptionalPositiveInteger(body.tabId, "tabId")
        },
        25000
      );
      sendJson(response, 200, data);
      return;
    }

    sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    const statusCode = error.statusCode || (error.message === "Invalid device token." ? 401 : 400);
    sendJson(response, statusCode, {
      error: error.message || "Unexpected error.",
      ...(error.layout ? { layout: error.layout } : {})
    });
  }
}

async function bootstrap() {
  await ensureDataStore();
  await authManager.ensure();
  remoteHelperSource = await fsp.readFile(REMOTE_HELPER_PATH, "utf8");

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    // /p/ carries proxied Browser resources (see server/url_proxy.js).
    if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/p/")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    await serveStaticFile(request, requestUrl.pathname, response);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Terminal Dock listening on http://${HOST}:${PORT}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    watcherRegistry.closeAll();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
