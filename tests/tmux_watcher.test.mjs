import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import watcherModule from "../server/tmux_watcher.js";

const { TmuxWatcher, WatcherRegistry, controlClientArgv, FLUSH_DELAY_MS } = watcherModule;

// A stand-in for `tmux -C`: records stdin commands, lets the test feed stdout.
function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = {
    written: [],
    write(text) {
      this.written.push(text);
    },
    end() {}
  };
  child.kill = () => child.emit("exit", 0);
  return child;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("output events are debounced into one change and routed by window", async () => {
  let child;
  const watcher = new TmuxWatcher(["tmux"], { spawnImpl: () => (child = fakeSpawn()) });
  assert.equal(child.stdin.written[0], "list-panes -s -F '#{pane_id} #{window_id}'\n");
  child.stdout.emit("data", "%begin 1 1 0\n%end 1 1 0\n");
  child.stdout.emit("data", "%begin 2 2 1\n%0 @0\n%1 @0\n%2 @1\n%end 2 2 1\n");
  await sleep(0);
  assert.deepEqual([...watcher.paneWindows.entries()], [["%0", "@0"], ["%1", "@0"], ["%2", "@1"]]);

  const changes = [];
  watcher.on("change", (change) => changes.push(change));
  child.stdout.emit("data", "%output %1 hello\n%output %1 wor");
  child.stdout.emit("data", "ld\n%output %2 x\n");
  await sleep(FLUSH_DELAY_MS + 20);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { panes: ["%1", "%2"], structure: false });
  assert.equal(watcher.concerns(changes[0], 0), true, "pane %1 shares window @0 with pane %0");
  assert.equal(watcher.concerns({ panes: ["%2"], structure: false }, 0), false);
  assert.equal(watcher.concerns({ panes: ["%2"], structure: false }, 2), true);
  assert.equal(watcher.concerns({ panes: [], structure: true }, 0), true);
  assert.equal(watcher.concerns({ panes: ["%9"], structure: false }, 7), true, "unknown panes are reported conservatively");
});

test("layout changes mark structure dirty and re-read the pane map; %exit ends the watcher", async () => {
  let child;
  const watcher = new TmuxWatcher(["tmux"], { spawnImpl: () => (child = fakeSpawn()) });
  child.stdout.emit("data", "%begin 1 1 0\n%end 1 1 0\n%begin 2 2 1\n%0 @0\n%end 2 2 1\n");
  const changes = [];
  watcher.on("change", (change) => changes.push(change));
  child.stdout.emit("data", "%layout-change @0 abcd,80x24,0,0,0 abcd,80x24,0,0,0 *\n");
  await sleep(FLUSH_DELAY_MS + 20);
  assert.deepEqual(changes, [{ panes: [], structure: true }]);
  assert.equal(child.stdin.written.filter((line) => line.startsWith("list-panes")).length, 2);

  let exited = false;
  watcher.on("exit", () => {
    exited = true;
  });
  child.stdout.emit("data", "%exit\n");
  assert.equal(exited, true);
  assert.equal(watcher.exited, true);
});

test("registry shares watchers per key and drops exited ones", () => {
  const children = [];
  const registry = new WatcherRegistry({
    spawnImpl: () => {
      const child = fakeSpawn();
      children.push(child);
      return child;
    }
  });
  const first = registry.get("a", () => ["tmux"]);
  assert.equal(registry.get("a", () => ["tmux"]), first);
  assert.equal(children.length, 1);
  children[0].stdout.emit("data", "%exit\n");
  const second = registry.get("a", () => ["tmux"]);
  assert.notEqual(second, first);
  assert.equal(children.length, 2);
  registry.closeAll();
  assert.equal(second.closed, true);
});

test("control client argv targets the session locally or over ssh", () => {
  const description = { tmuxBinary: "/opt/homebrew/bin/tmux", socket: "/tmp/tmux-501/default", sessionId: "$3" };
  assert.deepEqual(controlClientArgv({ transport: "local" }, description), [
    "/opt/homebrew/bin/tmux",
    "-S",
    "/tmp/tmux-501/default",
    "-C",
    "attach-session",
    "-t",
    "$3"
  ]);
  const ssh = controlClientArgv({ transport: "ssh", sshTarget: "gpu-box" }, description);
  assert.equal(ssh[0], "ssh");
  assert.equal(ssh[1], "gpu-box");
  assert.equal(ssh[2], "exec '/opt/homebrew/bin/tmux' '-S' '/tmp/tmux-501/default' '-C' 'attach-session' '-t' '$3'");
});
