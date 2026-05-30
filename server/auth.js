const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const SESSION_COOKIE_NAME = "krd_session";
const TOKEN_PREFIX = "krd_";
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS_PER_DEVICE = 16;
const SCRYPT_KEY_LENGTH = 32;

function nowIso() {
  return new Date().toISOString();
}

function randomBase64Url(byteLength) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function hashDeviceToken(token, salt) {
  return crypto.scryptSync(token, salt, SCRYPT_KEY_LENGTH).toString("base64url");
}

function hashSessionSecret(secret) {
  return crypto.createHash("sha256").update(secret, "utf8").digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createDeviceId() {
  return `device-${Date.now().toString(36)}-${randomBase64Url(5)}`;
}

function createEmptyStore() {
  return {
    createdAt: nowIso(),
    updatedAt: nowIso(),
    devices: []
  };
}

function normalizeStore(store) {
  return {
    ...createEmptyStore(),
    ...(store || {}),
    devices: Array.isArray(store?.devices) ? store.devices.map(normalizeDevice) : []
  };
}

function normalizeDevice(device) {
  const sessions = Array.isArray(device?.activeSessions)
    ? device.activeSessions.filter((session) => session?.hash && session?.expiresAt)
    : [];

  if (!sessions.length && device?.activeSessionHash && device?.activeSessionExpiresAt) {
    sessions.push({
      hash: device.activeSessionHash,
      createdAt: device.activeSessionCreatedAt || "",
      expiresAt: device.activeSessionExpiresAt
    });
  }

  return {
    ...(device || {}),
    activeSessions: sessions
  };
}

function createAuthManager(authFile) {
  return {
    authFile,

    async ensure() {
      await fsp.mkdir(path.dirname(authFile), { recursive: true });

      try {
        await fsp.access(authFile, fs.constants.F_OK);
      } catch (error) {
        await this.write(createEmptyStore());
      }
    },

    async read() {
      await this.ensure();
      const raw = await fsp.readFile(authFile, "utf8");
      return normalizeStore(JSON.parse(raw));
    },

    async write(store) {
      const nextStore = normalizeStore(store);
      nextStore.updatedAt = nowIso();
      await fsp.mkdir(path.dirname(authFile), { recursive: true });
      await fsp.writeFile(authFile, JSON.stringify(nextStore, null, 2), { mode: 0o600 });
    }
  };
}

function publicDevice(device) {
  if (!device) {
    return null;
  }

  const sessions = getActiveSessions(device);
  const latestSession = sessions[sessions.length - 1] || null;

  return {
    id: device.id,
    label: device.label,
    tokenPreview: device.tokenPreview,
    createdAt: device.createdAt,
    revokedAt: device.revokedAt || "",
    lastLoginAt: device.lastLoginAt || "",
    activeSessionCreatedAt: latestSession?.createdAt || device.activeSessionCreatedAt || "",
    activeSessionExpiresAt: latestSession?.expiresAt || device.activeSessionExpiresAt || "",
    activeSessionCount: sessions.length
  };
}

function getSessionTtlMs() {
  const hours = Number(process.env.KRD_SESSION_TTL_HOURS || "");

  if (Number.isFinite(hours) && hours > 0) {
    return Math.round(hours * 60 * 60 * 1000);
  }

  return DEFAULT_SESSION_TTL_MS;
}

function getMaxSessionsPerDevice() {
  const count = Number(process.env.KRD_MAX_SESSIONS_PER_DEVICE || "");

  if (Number.isInteger(count) && count > 0) {
    return count;
  }

  return DEFAULT_MAX_SESSIONS_PER_DEVICE;
}

function getActiveSessions(device) {
  return Array.isArray(device?.activeSessions)
    ? device.activeSessions.filter((session) => session?.hash && session?.expiresAt)
    : [];
}

function pruneExpiredSessions(device, now = Date.now()) {
  const before = getActiveSessions(device);
  const after = before.filter((session) => Date.parse(session.expiresAt) > now);
  device.activeSessions = after;

  if (after.length) {
    const latestSession = after[after.length - 1];
    device.activeSessionHash = latestSession.hash;
    device.activeSessionCreatedAt = latestSession.createdAt || "";
    device.activeSessionExpiresAt = latestSession.expiresAt || "";
  } else {
    device.activeSessionHash = "";
    device.activeSessionCreatedAt = "";
    device.activeSessionExpiresAt = "";
  }

  return after.length !== before.length;
}

function addActiveSession(device, session) {
  pruneExpiredSessions(device);
  const sessions = getActiveSessions(device);
  sessions.push(session);
  const cappedSessions = sessions.slice(-getMaxSessionsPerDevice());
  device.activeSessions = cappedSessions;
  device.activeSessionHash = session.hash;
  device.activeSessionCreatedAt = session.createdAt;
  device.activeSessionExpiresAt = session.expiresAt;
}

function clearAllSessions(device) {
  device.activeSessions = [];
  device.activeSessionHash = "";
  device.activeSessionCreatedAt = "";
  device.activeSessionExpiresAt = "";
}

async function createDeviceToken(manager, label) {
  const deviceLabel = String(label || "").trim();

  if (!deviceLabel) {
    throw new Error("Device label is required.");
  }

  const token = `${TOKEN_PREFIX}${randomBase64Url(32)}`;
  const salt = randomBase64Url(16);
  const store = await manager.read();
  const device = {
    id: createDeviceId(),
    label: deviceLabel,
    tokenPreview: `${token.slice(0, 8)}...${token.slice(-6)}`,
    tokenSalt: salt,
    tokenHash: hashDeviceToken(token, salt),
    createdAt: nowIso(),
    revokedAt: "",
    lastLoginAt: "",
    activeSessions: [],
    activeSessionHash: "",
    activeSessionCreatedAt: "",
    activeSessionExpiresAt: ""
  };

  store.devices.push(device);
  await manager.write(store);

  return {
    token,
    device: publicDevice(device)
  };
}

function findDevice(store, identifier) {
  const needle = String(identifier || "").trim();
  return store.devices.find((device) => device.id === needle || device.label === needle) || null;
}

async function revokeDevice(manager, identifier) {
  const store = await manager.read();
  const device = findDevice(store, identifier);

  if (!device) {
    throw new Error(`Device "${identifier}" was not found.`);
  }

  device.revokedAt = nowIso();
  clearAllSessions(device);
  await manager.write(store);
  return publicDevice(device);
}

async function rotateDeviceToken(manager, identifier) {
  const store = await manager.read();
  const device = findDevice(store, identifier);

  if (!device) {
    throw new Error(`Device "${identifier}" was not found.`);
  }

  const token = `${TOKEN_PREFIX}${randomBase64Url(32)}`;
  const salt = randomBase64Url(16);
  device.tokenPreview = `${token.slice(0, 8)}...${token.slice(-6)}`;
  device.tokenSalt = salt;
  device.tokenHash = hashDeviceToken(token, salt);
  device.revokedAt = "";
  clearAllSessions(device);
  await manager.write(store);

  return {
    token,
    device: publicDevice(device)
  };
}

async function listDevices(manager) {
  const store = await manager.read();
  return store.devices.map(publicDevice);
}

async function verifyDeviceToken(manager, token) {
  const rawToken = String(token || "").trim();

  if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) {
    throw new Error("Invalid device token.");
  }

  const store = await manager.read();
  const device = store.devices.find((candidate) => {
    if (candidate.revokedAt || !candidate.tokenSalt || !candidate.tokenHash) {
      return false;
    }

    return safeEqual(hashDeviceToken(rawToken, candidate.tokenSalt), candidate.tokenHash);
  });

  if (!device) {
    throw new Error("Invalid device token.");
  }

  const secret = randomBase64Url(32);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString();

  device.lastLoginAt = createdAt;
  addActiveSession(device, {
    hash: hashSessionSecret(secret),
    createdAt,
    expiresAt
  });
  await manager.write(store);

  return {
    device: publicDevice(device),
    sessionCookie: `${device.id}.${secret}`,
    expiresAt
  };
}

function parseSessionCookie(cookieHeader) {
  const rawHeader = String(cookieHeader || "").trim();
  let value = "";

  if (rawHeader && !rawHeader.includes("=") && rawHeader.includes(".")) {
    value = rawHeader;
  }

  const cookies = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const cookie = cookies.find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!cookie && !value) {
    return null;
  }

  if (!value) {
    value = decodeURIComponent(cookie.slice(SESSION_COOKIE_NAME.length + 1));
  }

  const dotIndex = value.indexOf(".");

  if (dotIndex <= 0 || dotIndex === value.length - 1) {
    return null;
  }

  return {
    deviceId: value.slice(0, dotIndex),
    secret: value.slice(dotIndex + 1)
  };
}

async function authenticateSession(manager, cookieHeader) {
  const parsed = parseSessionCookie(cookieHeader);

  if (!parsed) {
    return null;
  }

  const store = await manager.read();
  const device = store.devices.find((candidate) => candidate.id === parsed.deviceId) || null;

  if (!device || device.revokedAt) {
    return null;
  }

  const changed = pruneExpiredSessions(device);
  const sessionHash = hashSessionSecret(parsed.secret);
  const matched = getActiveSessions(device).some((session) => safeEqual(sessionHash, session.hash));

  if (changed) {
    await manager.write(store);
  }

  if (!matched) {
    return null;
  }

  return {
    device: publicDevice(device)
  };
}

async function clearSession(manager, cookieHeader) {
  const parsed = parseSessionCookie(cookieHeader);

  if (!parsed) {
    return false;
  }

  const store = await manager.read();
  const device = store.devices.find((candidate) => candidate.id === parsed.deviceId) || null;

  if (!device) {
    return false;
  }

  const sessionHash = hashSessionSecret(parsed.secret);
  const sessions = getActiveSessions(device);
  const nextSessions = sessions.filter((session) => !safeEqual(sessionHash, session.hash));

  if (nextSessions.length !== sessions.length) {
    device.activeSessions = nextSessions;
    pruneExpiredSessions(device, Number.NEGATIVE_INFINITY);
    await manager.write(store);
    return true;
  }

  return false;
}

function serializeSessionCookie(sessionCookie, options = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionCookie)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(getSessionTtlMs() / 1000)}`
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function serializeClearCookie(options = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

module.exports = {
  SESSION_COOKIE_NAME,
  authenticateSession,
  clearSession,
  createAuthManager,
  createDeviceToken,
  listDevices,
  parseSessionCookie,
  publicDevice,
  revokeDevice,
  rotateDeviceToken,
  serializeClearCookie,
  serializeSessionCookie,
  verifyDeviceToken
};
