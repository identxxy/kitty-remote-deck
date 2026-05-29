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
