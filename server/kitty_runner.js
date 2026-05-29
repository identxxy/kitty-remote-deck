const { spawn } = require("child_process");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeTransport(value) {
  const transport = String(value || "local").trim().toLowerCase();

  if (transport === "local" || transport === "ssh") {
    return transport;
  }

  throw new Error(`Unsupported target transport: ${value}`);
}

function createCommandPayload(target, payload) {
  return {
    ...payload,
    kittyBinary: target.kittyBinary,
    socketPattern: target.socketPattern,
    defaultSocket: target.defaultSocket
  };
}

function createKittyInvocation(target, action, payload, helperSource) {
  const transport = normalizeTransport(target.transport);
  const commandPayload = createCommandPayload(target, payload);
  const encodedPayload = Buffer.from(JSON.stringify(commandPayload), "utf8").toString("base64");

  if (transport === "local") {
    return {
      command: "python3",
      args: ["-", action, encodedPayload],
      stdin: helperSource,
      label: "local kitty helper"
    };
  }

  if (!target.sshTarget) {
    throw new Error("SSH target is required for SSH transport.");
  }

  return {
    command: "ssh",
    args: [target.sshTarget, `python3 - ${shellQuote(action)} ${shellQuote(encodedPayload)}`],
    stdin: helperSource,
    label: `ssh ${target.sshTarget}`
  };
}

function runInvocation(invocation, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const spawnImpl = options.spawnImpl || spawn;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(invocation.command, invocation.args, {
      cwd: options.cwd,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`${invocation.label} timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${invocation.label} exited with code ${code}.`));
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.end(invocation.stdin);
  });
}

async function runKittyAction(target, action, payload, options = {}) {
  const invocation = createKittyInvocation(target, action, payload, options.helperSource || "");
  const { stdout } = await runInvocation(invocation, options);

  let parsed;

  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Unexpected helper response: ${stdout.trim() || "<empty>"}`);
  }

  if (!parsed.ok) {
    throw new Error(parsed.error || "Kitty action failed.");
  }

  return parsed.data;
}

module.exports = {
  createKittyInvocation,
  normalizeTransport,
  runKittyAction,
  runInvocation
};
