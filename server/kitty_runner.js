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

function normalizeBackend(value) {
  const backend = String(value || "kitty").trim().toLowerCase();

  if (backend === "kitty" || backend === "tmux") {
    return backend;
  }

  throw new Error(`Unsupported target backend: ${value}`);
}

function createCommandPayload(target, payload) {
  return {
    ...payload,
    backend: normalizeBackend(target.backend),
    kittyBinary: target.kittyBinary,
    tmuxBinary: target.tmuxBinary,
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

    // Collected as bytes and decoded once: a multibyte character split across
    // two chunks would otherwise decode as U+FFFD, corrupting CJK and box
    // drawing in large captures.
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`${invocation.label} timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
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
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

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
  normalizeBackend,
  normalizeTransport,
  runKittyAction,
  runInvocation
};
