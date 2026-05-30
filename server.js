const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL } = require("url");
const {
  authenticateSession,
  clearSession,
  createAuthManager,
  serializeClearCookie,
  serializeSessionCookie,
  verifyDeviceToken
} = require("./server/auth");
const { normalizeTransport, runKittyAction } = require("./server/kitty_runner");
const {
  createProxyUrl,
  isCssContentType,
  isHtmlContentType,
  rewriteCssResources,
  rewriteHtmlResources
} = require("./server/url_proxy");
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
const AUTH_FILE = process.env.KRD_AUTH_FILE || path.join(DATA_DIR, "auth.json");
const CLIENT_DEBUG_LOG_FILE = path.join(TMP_DIR, "client-debug.log");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const REMOTE_HELPER_PATH = path.join(ROOT_DIR, "server", "remote_helper.py");
const MAX_IMAGE_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES * 1.6);
const authManager = createAuthManager(AUTH_FILE);

const DEFAULT_TARGET = {
  id: "local",
  name: "Local Kitty",
  transport: "local",
  sshTarget: "",
  kittyBinary: "kitty",
  socketPattern: "/tmp/kitty.sock-*",
  defaultSocket: "",
  notes: "Local GUI kitty session on this machine"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
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
  const target = {
    id: String(input.id || fallbackId || createId()).trim(),
    name: String(input.name || "").trim(),
    transport,
    sshTarget: String(input.sshTarget || "").trim(),
    kittyBinary: String(input.kittyBinary || DEFAULT_TARGET.kittyBinary).trim(),
    socketPattern: String(input.socketPattern || DEFAULT_TARGET.socketPattern).trim(),
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
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendJsonWithHeaders(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function sendBuffer(response, statusCode, buffer, contentType, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(buffer);
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

function parseWindowId(value) {
  const windowId = Number(value);
  if (!Number.isInteger(windowId) || windowId <= 0) {
    throw new Error("windowId must be a positive integer.");
  }
  return windowId;
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

function transformFetchedResource(data, targetId) {
  const contentType = data.contentType || "application/octet-stream";
  const finalUrl = data.finalUrl || data.url;
  const rawBuffer = decodeFetchedResource(data);

  if (isHtmlContentType(contentType)) {
    const html = typeof data.body === "string" ? data.body : rawBuffer.toString(data.encoding || "utf8");
    return {
      buffer: Buffer.from(rewriteHtmlResources(html, finalUrl, targetId), data.encoding || "utf8"),
      contentType
    };
  }

  if (isCssContentType(contentType)) {
    const css = typeof data.body === "string" ? data.body : rawBuffer.toString(data.encoding || "utf8");
    return {
      buffer: Buffer.from(rewriteCssResources(css, finalUrl, targetId), data.encoding || "utf8"),
      contentType
    };
  }

  return {
    buffer: rawBuffer,
    contentType
  };
}

async function serveStaticFile(requestPath, response) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const absolutePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fsp.readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch (error) {
    const fallback = path.join(PUBLIC_DIR, "index.html");

    try {
      const file = await fsp.readFile(fallback);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[".html"],
        "Cache-Control": "no-store"
      });
      response.end(file);
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

    const auth = await authenticateRequest(request);

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

    if (request.method === "GET" && requestUrl.pathname === "/api/url-resource") {
      const targetId = requestUrl.searchParams.get("targetId") || "";
      const url = requestUrl.searchParams.get("url") || "";
      const target = await resolveTargetFromRequest({ targetId });
      const data = await runRemoteKittyAction(
        target,
        "fetch_url",
        {
          url
        },
        45000
      );
      const transformed = transformFetchedResource(data, target.id);
      sendBuffer(response, 200, transformed.buffer, transformed.contentType, {
        "X-KRD-Final-URL": encodeURIComponent(data.finalUrl || data.url || url),
        "X-KRD-Truncated": data.truncated ? "1" : "0"
      });
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

    if (request.method === "GET" && requestUrl.pathname === "/api/screen") {
      const target = await resolveTargetFromRequest({
        targetId: requestUrl.searchParams.get("targetId")
      });
      const windowId = parseWindowId(requestUrl.searchParams.get("windowId"));

      const data = await runRemoteKittyAction(
        target,
        "get_screen",
        {
          socket: requestUrl.searchParams.get("socket") || "",
          windowId,
          extent: requestUrl.searchParams.get("extent") === "all" ? "all" : "screen"
        },
        25000
      );
      sendJson(response, 200, data);
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

      const data = await runRemoteKittyAction(
        target,
        "send_key",
        {
          socket: body.socket || "",
          windowId,
          key: String(body.key || "enter")
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
      const lines = parseScrollLines(body.lines);

      const data = await runRemoteKittyAction(
        target,
        "scroll_window",
        {
          socket: body.socket || "",
          windowId,
          lines
        },
        25000
      );
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

    sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    const statusCode = error.message === "Invalid device token." ? 401 : 400;
    sendJson(response, statusCode, {
      error: error.message || "Unexpected error."
    });
  }
}

async function bootstrap() {
  await ensureDataStore();
  await authManager.ensure();
  remoteHelperSource = await fsp.readFile(REMOTE_HELPER_PATH, "utf8");

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    await serveStaticFile(requestUrl.pathname, response);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Kitty Remote Deck listening on http://${HOST}:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
