// Event source for tmux targets: one control-mode client (`tmux -C attach`) per
// session. tmux reports every pane's output as `%output`, so the deck learns
// that a window changed within milliseconds instead of polling for it. The
// output bytes themselves are discarded; subscribers re-capture the screen
// through the normal helper, which keeps rendering on one code path.
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

const FLUSH_DELAY_MS = 80;
const IDLE_CLOSE_MS = 30000;
const STRUCTURE_EVENTS = new Set([
  "%layout-change",
  "%window-add",
  "%window-close",
  "%window-renamed",
  "%window-pane-changed",
  "%unlinked-window-add",
  "%unlinked-window-close",
  "%unlinked-window-renamed",
  "%session-window-changed",
  "%sessions-changed",
  "%session-renamed"
]);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

// argv for a control-mode client of one session, locally or through ssh.
function controlClientArgv(target, description) {
  const tmux = description.tmuxBinary || "tmux";
  const args = ["-S", description.socket, "-C", "attach-session", "-t", description.sessionId];
  if (target.transport === "ssh") {
    return ["ssh", target.sshTarget, `exec ${shellQuote(tmux)} ${args.map(shellQuote).join(" ")}`];
  }
  return [tmux, ...args];
}

class TmuxWatcher extends EventEmitter {
  constructor(argv, options = {}) {
    super();
    this.argv = argv;
    this.label = options.label || argv.join(" ");
    this.spawnImpl = options.spawnImpl || spawn;
    this.refs = 0;
    this.closed = false;
    this.exited = false;
    this.dirtyPanes = new Set();
    this.structureDirty = false;
    this.flushTimer = null;
    this.idleTimer = null;
    this.paneWindows = new Map();
    this.pendingCommands = [];
    this.block = null;
    this.buffer = "";
    this.start();
  }

  start() {
    this.child = this.spawnImpl(this.argv[0], this.argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.lastError = String(chunk).trim();
    });
    this.child.on("error", (error) => {
      this.lastError = error.message;
      this.finish();
    });
    this.child.on("exit", () => this.finish());
    this.refreshPaneWindows();
  }

  consume(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
    }
  }

  handleLine(line) {
    if (this.block) {
      if (line.startsWith("%end ") || line.startsWith("%error ")) {
        const { resolve, lines } = this.block;
        this.block = null;
        resolve(lines);
        this.pump();
      } else {
        this.block.lines.push(line);
      }
      return;
    }
    if (line.startsWith("%begin ")) {
      // "%begin time number flags": flags bit 1 marks a reply to this client's
      // own command; the block tmux sends on connect has it clear.
      const flags = Number(line.split(" ")[3] || 0);
      const ours = (flags & 1) === 1 && this.pendingCommands.length && this.pendingCommands[0].sent;
      const pending = ours ? this.pendingCommands.shift() : null;
      this.block = { resolve: pending ? pending.resolve : () => {}, lines: [] };
      return;
    }
    if (!line.startsWith("%")) {
      return;
    }
    const space = line.indexOf(" ");
    const name = space === -1 ? line : line.slice(0, space);
    if (name === "%output") {
      const paneId = line.slice(space + 1).split(" ", 1)[0];
      this.dirtyPanes.add(paneId);
      this.scheduleFlush();
    } else if (STRUCTURE_EVENTS.has(name)) {
      this.structureDirty = true;
      this.scheduleFlush();
      this.refreshPaneWindows();
    } else if (name === "%exit") {
      this.finish();
    }
  }

  // Commands go to the control client's stdin; tmux answers inside %begin/%end.
  command(text) {
    return new Promise((resolve) => {
      this.pendingCommands.push({ text, resolve, sent: false });
      this.pump();
    });
  }

  pump() {
    if (this.block || this.exited || !this.pendingCommands.length || this.pendingCommands[0].sent) {
      return;
    }
    const next = this.pendingCommands[0];
    next.sent = true;
    this.child.stdin.write(`${next.text}\n`);
  }

  async refreshPaneWindows() {
    const lines = await this.command("list-panes -s -F '#{pane_id} #{window_id}'");
    const next = new Map();
    for (const line of lines) {
      const [paneId, windowId] = line.trim().split(" ");
      if (paneId && windowId) {
        next.set(paneId, windowId);
      }
    }
    if (next.size) {
      this.paneWindows = next;
    }
  }

  scheduleFlush() {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }
  }

  flush() {
    this.flushTimer = null;
    const panes = [...this.dirtyPanes];
    const structure = this.structureDirty;
    this.dirtyPanes.clear();
    this.structureDirty = false;
    if (panes.length || structure) {
      this.emit("change", { panes, structure });
    }
  }

  // Whether a change touches the tmux window that holds deck pane %<paneId>.
  concerns(change, paneId) {
    if (change.structure) {
      return true;
    }
    const windowId = this.paneWindows.get(`%${paneId}`);
    if (!windowId) {
      return change.panes.length > 0;
    }
    return change.panes.some((pane) => (this.paneWindows.get(pane) || windowId) === windowId);
  }

  acquire() {
    this.refs += 1;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  release() {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0 && !this.idleTimer) {
      this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
    }
  }

  finish() {
    if (this.exited) {
      return;
    }
    this.exited = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.idleTimer);
    for (const pending of this.pendingCommands.splice(0)) {
      pending.resolve([]);
    }
    if (this.block) {
      this.block.resolve([]);
      this.block = null;
    }
    this.emit("exit", this.lastError || "");
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (!this.exited) {
      this.child.stdin.end();
      this.child.kill();
    }
    this.finish();
  }
}

// Watchers shared by every subscriber of the same target/socket/session.
class WatcherRegistry {
  constructor(options = {}) {
    this.watchers = new Map();
    this.options = options;
  }

  get(key, argvFactory) {
    let watcher = this.watchers.get(key);
    if (watcher && (watcher.exited || watcher.closed)) {
      this.watchers.delete(key);
      watcher = null;
    }
    if (!watcher) {
      watcher = new TmuxWatcher(argvFactory(), { label: key, spawnImpl: this.options.spawnImpl });
      watcher.once("exit", () => {
        if (this.watchers.get(key) === watcher) {
          this.watchers.delete(key);
        }
      });
      this.watchers.set(key, watcher);
    }
    return watcher;
  }

  closeAll() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = { TmuxWatcher, WatcherRegistry, controlClientArgv, FLUSH_DELAY_MS, IDLE_CLOSE_MS };
