import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  authenticateSession,
  createAuthManager,
  createDeviceToken,
  parseSessionCookie,
  verifyDeviceToken
} from "../server/auth.js";

async function withAuthManager(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "krd-auth-"));
  const manager = createAuthManager(path.join(dir, "auth.json"));

  try {
    await fn(manager);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("device tokens are stored as hashes and verify by raw token", async () => {
  await withAuthManager(async (manager) => {
    const created = await createDeviceToken(manager, "iPhone");
    const store = await manager.read();

    assert.equal(store.devices.length, 1);
    assert.equal(store.devices[0].label, "iPhone");
    assert.notEqual(store.devices[0].tokenHash, created.token);
    assert.match(created.token, /^krd_/);

    const verified = await verifyDeviceToken(manager, created.token);
    assert.equal(verified.device.label, "iPhone");
  });
});

test("a device token can keep multiple active browser sessions", async () => {
  await withAuthManager(async (manager) => {
    const created = await createDeviceToken(manager, "iPad");

    const first = await verifyDeviceToken(manager, created.token);
    const second = await verifyDeviceToken(manager, created.token);

    assert.notEqual(first.sessionCookie, second.sessionCookie);
    assert.equal((await authenticateSession(manager, first.sessionCookie)).device.label, "iPad");

    const authenticated = await authenticateSession(manager, second.sessionCookie);
    assert.equal(authenticated.device.label, "iPad");
    assert.equal(authenticated.device.activeSessionCount, 2);
  });
});

test("session cookies are parsed defensively", () => {
  assert.deepEqual(parseSessionCookie("krd_session=device-1.secret; theme=dark"), {
    deviceId: "device-1",
    secret: "secret"
  });
  assert.equal(parseSessionCookie("theme=dark"), null);
  assert.equal(parseSessionCookie("krd_session=missing-dot"), null);
});
