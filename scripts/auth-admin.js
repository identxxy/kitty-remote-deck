#!/usr/bin/env node

const path = require("path");
const {
  createAuthManager,
  createDeviceToken,
  listDevices,
  revokeDevice,
  rotateDeviceToken
} = require("../server/auth");

const ROOT_DIR = path.join(__dirname, "..");
const AUTH_FILE = process.env.KRD_AUTH_FILE || path.join(ROOT_DIR, "data", "auth.json");
const manager = createAuthManager(AUTH_FILE);

function usage() {
  console.log(`Usage:
  node scripts/auth-admin.js create-device <label>
  node scripts/auth-admin.js list-devices
  node scripts/auth-admin.js revoke-device <device-id-or-label>
  node scripts/auth-admin.js rotate-device <device-id-or-label>

Auth file:
  ${AUTH_FILE}`);
}

function printDevice(device) {
  const status = device.revokedAt ? "revoked" : "active";
  const sessionCount = Number(device.activeSessionCount || 0);
  const activeSession = sessionCount
    ? `${sessionCount} session${sessionCount === 1 ? "" : "s"} until ${device.activeSessionExpiresAt}`
    : "no active session";
  console.log(`${device.id}\t${status}\t${device.label}\t${device.tokenPreview || "-"}\t${activeSession}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "create-device") {
    const label = args.join(" ").trim();
    const created = await createDeviceToken(manager, label);
    console.log(`Device: ${created.device.label}`);
    console.log(`ID: ${created.device.id}`);
    console.log("");
    console.log("Token, shown once:");
    console.log(created.token);
    return;
  }

  if (command === "list-devices") {
    const devices = await listDevices(manager);
    if (!devices.length) {
      console.log("No devices.");
      return;
    }

    devices.forEach(printDevice);
    return;
  }

  if (command === "revoke-device") {
    const identifier = args.join(" ").trim();
    const device = await revokeDevice(manager, identifier);
    console.log(`Revoked ${device.label} (${device.id}).`);
    return;
  }

  if (command === "rotate-device") {
    const identifier = args.join(" ").trim();
    const rotated = await rotateDeviceToken(manager, identifier);
    console.log(`Device: ${rotated.device.label}`);
    console.log(`ID: ${rotated.device.id}`);
    console.log("");
    console.log("New token, shown once:");
    console.log(rotated.token);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
