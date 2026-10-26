import assert from "node:assert/strict";
import test from "node:test";

import runner from "../server/kitty_runner.js";

const {
  createKittyInvocation,
  normalizeTransport
} = runner;

test("transport defaults to local and preserves explicit ssh", () => {
  assert.equal(normalizeTransport(), "local");
  assert.equal(normalizeTransport(""), "local");
  assert.equal(normalizeTransport("local"), "local");
  assert.equal(normalizeTransport("ssh"), "ssh");
  assert.throws(() => normalizeTransport("telnet"), /Unsupported target transport/);
});

test("local invocation runs the helper directly without ssh", () => {
  const invocation = createKittyInvocation(
    {
      transport: "local",
      kittyBinary: "/usr/bin/kitty",
      socketPattern: "/tmp/kitty.sock-*",
      defaultSocket: "/tmp/kitty.sock-1"
    },
    "test",
    { socket: "" },
    "helper source"
  );

  assert.equal(invocation.command, "python3");
  assert.deepEqual(invocation.args.slice(0, 2), ["-", "test"]);
  assert.equal(invocation.stdin, "helper source");
  assert.equal(invocation.args.length, 3);
  assert.doesNotMatch(invocation.args.join(" "), /\bssh\b/);
});

test("ssh invocation keeps the existing ssh helper path", () => {
  const invocation = createKittyInvocation(
    {
      transport: "ssh",
      sshTarget: "example-host",
      kittyBinary: "kitty",
      socketPattern: "/tmp/kitty.sock-*",
      defaultSocket: ""
    },
    "list_sessions",
    { socket: "/tmp/kitty.sock-1" },
    "helper source"
  );

  assert.equal(invocation.command, "ssh");
  assert.equal(invocation.args[0], "example-host");
  assert.match(invocation.args[1], /^python3 - 'list_sessions' '/);
  assert.equal(invocation.stdin, "helper source");
});

test("backend defaults to kitty and accepts tmux", () => {
  assert.equal(runner.normalizeBackend(), "kitty");
  assert.equal(runner.normalizeBackend("kitty"), "kitty");
  assert.equal(runner.normalizeBackend("tmux"), "tmux");
  assert.throws(() => runner.normalizeBackend("screen"), /Unsupported target backend/);
});

test("invocation payload carries the backend and tmux binary", () => {
  const invocation = createKittyInvocation(
    {
      transport: "local",
      backend: "tmux",
      tmuxBinary: "/usr/bin/tmux",
      socketPattern: "",
      defaultSocket: ""
    },
    "list_sessions",
    { socket: "" },
    "helper source"
  );

  const payload = JSON.parse(Buffer.from(invocation.args[2], "base64").toString("utf8"));
  assert.equal(payload.backend, "tmux");
  assert.equal(payload.tmuxBinary, "/usr/bin/tmux");
  assert.equal(payload.socketPattern, "");
});

test("helper output split inside a multibyte character decodes intact", async () => {
  const { EventEmitter } = await import("node:events");
  const text = JSON.stringify({ ok: true, data: { text: "─".repeat(5) + "中文" } });
  const bytes = Buffer.from(text, "utf8");
  const cut = bytes.indexOf(Buffer.from("─")) + 1; // inside the 3-byte box character
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit("data", bytes.subarray(0, cut));
      child.stdout.emit("data", bytes.subarray(cut));
      child.emit("close", 0);
    });
    return child;
  };
  const data = await runner.runKittyAction(
    { transport: "local", kittyBinary: "kitty", socketPattern: "/tmp/kitty.sock-*", defaultSocket: "" },
    "get_screen",
    { socket: "" },
    { spawnImpl, helperSource: "helper source" }
  );
  assert.equal(data.text, "─".repeat(5) + "中文");
  assert.doesNotMatch(data.text, /�/);
});
