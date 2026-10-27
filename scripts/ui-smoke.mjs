// Real-browser smoke for the workbench UI: layout lock, Browser drawer drag
// and the right-edge handle, Layouts autosave with the 409 conflict path, and
// the phone navigation stack. Drives Chrome over the DevTools protocol with
// no dependencies and signs in with a real device token, so the flows go
// through the real server.
//
//   DECK_URL      deck to test (default http://127.0.0.1:3040); never a deck
//                 whose data/ you care about: the run saves and deletes a layout
//                 and records the fixture page in Reports.
//   DECK_TOKEN    device token for DECK_URL (required)
//   DECK_TARGET   tmux target id (default mc-tmux)
//   DECK_SESSION  name of a throwaway tmux session on that target (default krdsmoke)
//   DECK_FIXTURE  an HTML file on the target to open in the Browser (default:
//                 tests/fixtures/smoke-report.html of this checkout, which is
//                 right when the target is local to this machine)
//   CDP_URL       DevTools endpoint of a running Chrome (http://host:port); when
//                 unset, a local Chrome is started (CHROME_BIN to point at it)
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DECK_URL = (process.env.DECK_URL || "http://127.0.0.1:3040").replace(/\/$/, "");
const DECK_TOKEN = process.env.DECK_TOKEN || "";
const DECK_TARGET = process.env.DECK_TARGET || "mc-tmux";
const DECK_SESSION = process.env.DECK_SESSION || "krdsmoke";
const DECK_FIXTURE = process.env.DECK_FIXTURE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/smoke-report.html");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!DECK_TOKEN) {
  console.error("DECK_TOKEN is required (scripts/auth-admin.js create-device <label>).");
  process.exit(2);
}

// ---- Chrome ------------------------------------------------------------------
let chrome = null;
let cdpUrl = process.env.CDP_URL || "";
const userDataDir = `/tmp/terminal-dock-ui-smoke-${process.pid}`;

async function startLocalChrome() {
  const candidates = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  let binary = "";
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      binary = candidate;
      break;
    } catch (error) {
      // try the next one
    }
  }
  if (!binary) {
    throw new Error("No Chrome found; set CHROME_BIN or CDP_URL.");
  }
  const port = 9400 + Math.floor(Math.random() * 500);
  chrome = spawn(binary, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*", `--user-data-dir=${userDataDir}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  cdpUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${cdpUrl}/json/version`);
      return;
    } catch (error) {
      await delay(100);
    }
  }
  throw new Error("Chrome did not open its DevTools port.");
}

// One DevTools session per page target.
async function openPage() {
  const response = await fetch(`${cdpUrl}/json/new?about:blank`, { method: "PUT" });
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Set();
  const issues = [];
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
      return;
    }
    if (message.method === "Page.javascriptDialogOpening") {
      // confirm()/alert() block the renderer until answered; accept them (delete confirmations).
      page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
    if (message.method === "Runtime.exceptionThrown") {
      issues.push(`page error: ${message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text}`.slice(0, 300));
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      issues.push(`console.error: ${message.params.args.map((arg) => arg.value || arg.description || "").join(" ")}`.slice(0, 300));
    }
    for (const listener of listeners) {
      listener(message);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const page = {
    issues,
    send(method, params = {}, timeoutMs = 30000) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} did not answer within ${timeoutMs} ms (renderer blocked?).`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); }
        });
      });
    },
    waitFor(method, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(handler);
          reject(new Error(`Timed out waiting for ${method}.`));
        }, timeoutMs);
        function handler(message) {
          if (message.method === method) {
            clearTimeout(timer);
            listeners.delete(handler);
            resolve(message.params || {});
          }
        }
        listeners.add(handler);
      });
    },
    // fn is a function source; args are passed JSON-encoded.
    async eval(fn, ...args) {
      const expression = `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
      const result = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    },
    async waitUntil(fn, timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await page.eval(fn)) {
          return;
        }
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${fn}`);
    },
    async goto(url) {
      const loaded = page.waitFor("Page.loadEventFired");
      await page.send("Page.navigate", { url });
      await loaded;
    },
    async rect(selector) {
      return page.eval((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return null;
        }
        const box = element.getBoundingClientRect();
        return { x: box.left, y: box.top, width: box.width, height: box.height, cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
      }, selector);
    },
    async mouseDrag(from, to, steps = 6) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
      for (let index = 1; index <= steps; index += 1) {
        const x = from.x + ((to.x - from.x) * index) / steps;
        const y = from.y + ((to.y - from.y) * index) / steps;
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left" });
        await delay(20);
      }
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 });
      await delay(150);
    },
    async tap(x, y) {
      await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 3, radiusY: 3, force: 1 }] });
      await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await delay(200);
    },
    async close() {
      socket.close();
      await fetch(`${cdpUrl}/json/close/${target.id}`).catch(() => {});
    }
  };
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  return page;
}

async function signIn(page, viewport) {
  await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: viewport.mobile });
  await page.goto(`${DECK_URL}/api/health`);
  const status = await page.eval(async (token) => {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    return response.status;
  }, DECK_TOKEN);
  if (status !== 200) {
    throw new Error(`Login returned ${status}; check DECK_TOKEN.`);
  }
  await page.eval(() => localStorage.clear());
  await page.goto(`${DECK_URL}/`);
  await page.waitUntil(() => document.readyState === "complete" && typeof state !== "undefined" && state.authenticated);
}

async function connectAndSelectPane(page) {
  await page.eval(async (targetId) => {
    state.selectedTargetId = targetId;
    state.editingTargetId = targetId;
    await connectSelectedTarget();
  }, DECK_TARGET);
  await page.waitUntil(() => Array.isArray(state.sessionTree) && state.sessionTree.length > 0);
  const paneId = await page.eval((sessionName) => {
    const session = state.sessionTree.find((item) => item.title === sessionName);
    return session?.tabs?.[0]?.windows?.[0]?.id ?? null;
  }, DECK_SESSION);
  if (paneId === null) {
    throw new Error(`No tmux session named ${DECK_SESSION} on ${DECK_TARGET}; create one with "tmux new-session -d -s ${DECK_SESSION}".`);
  }
  await page.eval((id) => selectWindow(id), paneId);
  await page.waitUntil((id) => state.selectedWindowId === id && state.paneRoot !== null, 15000).catch(() => {});
  await delay(800);
  return paneId;
}

// ---- Checks -------------------------------------------------------------------
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail === undefined ? "" : JSON.stringify(detail) });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

function expect(condition, message, detail) {
  if (!condition) {
    throw new Error(`${message}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
  }
}

const browserSnapshot = () => ({
  open: document.querySelector("#appShell").classList.contains("preview-open"),
  width: getEffectiveBrowserWidth(),
  bounds: getBrowserWidthBounds(),
  handleHidden: document.querySelector("#browserHandleBtn").hidden,
  handleLabel: document.querySelector("#browserHandleBtn").getAttribute("aria-label") || ""
});

async function desktopChecks() {
  const page = await openPage();
  try {
    await signIn(page, { width: 1440, height: 900, mobile: false });
    await connectAndSelectPane(page);

    await check("desktop: lock toggle moves no layout", async () => {
      const before = await page.rect(".editor-region");
      await page.eval(() => document.querySelector("#resizeToggle").click());
      await delay(150);
      const unlocked = await page.eval(() => ({
        enabled: state.resizeEnabled,
        classed: document.querySelector("#appShell").classList.contains("resize-enabled"),
        pressed: document.querySelector("#resizeToggle").getAttribute("aria-pressed"),
        label: document.querySelector("#resizeToggle").textContent.trim()
      }));
      const after = await page.rect(".editor-region");
      await page.eval(() => document.querySelector("#resizeToggle").click());
      expect(unlocked.enabled && unlocked.classed && unlocked.pressed === "true", "unlock did not apply", unlocked);
      expect(Math.abs(after.x - before.x) < 1 && Math.abs(after.width - before.width) < 1, "editor moved when unlocking", { before, after });
      return unlocked.label;
    });

    await check("desktop: Browser opens and drags within bounds while locked", async () => {
      await page.eval((url) => loadUrlPreview(url, { history: "reset" }), `file://${DECK_FIXTURE}`);
      await page.waitUntil(() => document.querySelector("#appShell").classList.contains("preview-open"));
      await delay(600);
      const start = await page.eval(browserSnapshot);
      expect(start.open, "drawer not open", start);
      const handle = await page.rect("#browserResizeHandle");
      expect(handle && handle.width > 0, "no browser resize handle", handle);
      await page.mouseDrag({ x: handle.cx, y: handle.cy }, { x: handle.cx - 200, y: handle.cy });
      const wider = await page.eval(browserSnapshot);
      expect(Math.abs(wider.width - (start.width + 200)) <= 2, "drag left did not widen by 200", { start, wider });
      const handle2 = await page.rect("#browserResizeHandle");
      await page.mouseDrag({ x: handle2.cx, y: handle2.cy }, { x: handle2.cx - 3000, y: handle2.cy });
      const max = await page.eval(browserSnapshot);
      expect(max.width === max.bounds.max, "drag past the left did not clamp to max", max);
      const handle3 = await page.rect("#browserResizeHandle");
      await page.mouseDrag({ x: handle3.cx, y: handle3.cy }, { x: handle3.cx + 3000, y: handle3.cy });
      const min = await page.eval(browserSnapshot);
      expect(min.width === min.bounds.min, "drag past the right did not clamp to min", min);
      return { start: start.width, wider: wider.width, max: max.width, min: min.width, bounds: min.bounds };
    });

    await check("desktop: right-edge handle shows when closed and reopens the Browser", async () => {
      const whileOpen = await page.eval(browserSnapshot);
      expect(whileOpen.handleHidden, "handle visible while the drawer is open", whileOpen);
      await page.eval(() => document.querySelector("#closePreviewBtn").click());
      await delay(300);
      const closed = await page.eval(browserSnapshot);
      expect(!closed.open && !closed.handleHidden, "handle hidden after closing", closed);
      const box = await page.rect("#browserHandleBtn");
      expect(box && box.x > 1300, "handle not at the right edge", box);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.cx, y: box.cy });
      await delay(350);
      const hovered = await page.rect("#browserHandleBtn");
      expect(hovered.width > box.width + 20, "handle did not expand on hover", { box, hovered });
      await page.eval(() => document.querySelector("#browserHandleBtn").click());
      await delay(300);
      const reopened = await page.eval(browserSnapshot);
      expect(reopened.open && reopened.handleHidden, "handle click did not reopen", reopened);
      return { label: closed.handleLabel, collapsed: Math.round(box.width), hovered: Math.round(hovered.width) };
    });

    await check("desktop: layout save, autosave on split, 409 on a stale write, delete", async () => {
      const name = `smoke-${Date.now().toString(36)}`;
      await page.eval(() => document.querySelector("#closePreviewBtn").click());
      await page.eval(async (layoutName) => {
        await saveLayoutAs(layoutName);
      }, name);
      await page.waitUntil(() => state.activeLayoutId && state.layouts.some((item) => item.id === state.activeLayoutId));
      const saved = await page.eval(() => {
        const layout = state.layouts.find((item) => item.id === state.activeLayoutId);
        return { id: layout.id, name: layout.name, updatedAt: layout.updatedAt, leaves: PANE_TREE.leaves(state.paneRoot).length };
      });
      expect(saved.name === name && saved.leaves === 1, "save did not activate the new layout", saved);

      await page.eval(() => splitActivePane("horizontal"));
      await delay(1500);
      const onServer = await page.eval(async (id) => {
        const data = await (await fetch("/api/layouts")).json();
        const layout = data.layouts.find((item) => item.id === id);
        return layout ? { leaves: PANE_TREE.leaves(layout.paneRoot).length, updatedAt: layout.updatedAt } : null;
      }, saved.id);
      expect(onServer && onServer.leaves === 2, "split was not autosaved", onServer);
      expect(onServer.updatedAt !== saved.updatedAt, "updatedAt did not advance", { saved, onServer });

      const stale = await page.eval(async (id, layoutName, updatedAt) => {
        const response = await fetch("/api/layouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: { id, name: layoutName, paneRoot: state.paneRoot, activePaneId: state.activePaneId }, expectedUpdatedAt: updatedAt })
        });
        const payload = await response.json();
        return { status: response.status, hasLayout: Boolean(payload.layout), error: payload.error || "" };
      }, saved.id, name, saved.updatedAt);
      expect(stale.status === 409 && stale.hasLayout, "stale write was not refused with the current copy", stale);

      await page.eval(async (id) => {
        await deleteLayout(id);
      }, saved.id);
      await delay(500);
      const afterDelete = await page.eval(async (id) => {
        const data = await (await fetch("/api/layouts")).json();
        return { stillListed: data.layouts.some((item) => item.id === id), active: state.activeLayoutId, leaves: PANE_TREE.leaves(state.paneRoot).length };
      }, saved.id);
      expect(!afterDelete.stillListed && afterDelete.active === null, "delete did not return to Scratch", afterDelete);
      return { name, split: onServer.leaves, stale: stale.status };
    });
  } finally {
    const issues = page.issues.slice();
    await page.close();
    return issues;
  }
}

const navSnapshot = () => {
  const backIds = { sessions: "mobileBackToConnectBtn", chat: "mobileBackToSessionsBtn", layouts: "mobileBackFromLayoutsBtn", reports: "mobileBackFromBrowserListBtn", browser: "mobileBrowserBackBtn" };
  const backId = backIds[state.mobileScreen];
  return {
    screen: state.mobileScreen,
    stack: state.mobileStack.join(">"),
    historyIndex: history.state ? history.state.krdIndex : null,
    back: backId ? document.getElementById(backId).textContent.trim() : "",
    handleHidden: document.querySelector("#browserHandleBtn").hidden
  };
};

async function phoneChecks() {
  const page = await openPage();
  try {
    await signIn(page, { width: 430, height: 844, mobile: true });
    await delay(1500);
    await connectAndSelectPane(page);

    await check("phone: selecting a pane pushes the terminal screen", async () => {
      await page.waitUntil(() => state.mobileScreen === "chat");
      const nav = await page.eval(navSnapshot);
      expect(nav.stack === "connect>sessions>chat" && nav.historyIndex === 2, "stack after pane selection", nav);
      expect(nav.back.includes("Sessions"), "back button does not name Sessions", nav);
      return nav;
    });

    await check("phone: Browser pushes, back button pops, handle reopens", async () => {
      await page.eval((url) => loadUrlPreview(url, { history: "reset" }), `file://${DECK_FIXTURE}`);
      await page.waitUntil(() => state.mobileScreen === "browser");
      await delay(500);
      const inBrowser = await page.eval(navSnapshot);
      expect(inBrowser.stack === "connect>sessions>chat>browser" && inBrowser.historyIndex === 3, "stack after opening the Browser", inBrowser);
      expect(inBrowser.back.includes("Terminal"), "Browser back button does not name Terminal", inBrowser);
      await page.eval(() => document.querySelector("#mobileBrowserBackBtn").click());
      await delay(500);
      const back = await page.eval(navSnapshot);
      expect(back.screen === "chat" && back.stack === "connect>sessions>chat" && back.historyIndex === 2, "back button did not pop", back);
      expect(!back.handleHidden, "handle hidden on the terminal screen", back);
      const box = await page.rect("#browserHandleBtn");
      expect(box && box.x > 380, "handle not at the right edge", box);
      await page.tap(box.cx, box.cy);
      await delay(600);
      const reopened = await page.eval(navSnapshot);
      expect(reopened.screen === "browser" && reopened.stack === "connect>sessions>chat>browser", "handle tap did not push the Browser", reopened);
      return { back: inBrowser.back, handle: Math.round(box.width) };
    });

    await check("phone: swipe back/forward follows the stack, foreign entries reset", async () => {
      await page.eval(() => history.back());
      await delay(600);
      const back = await page.eval(navSnapshot);
      expect(back.screen === "chat" && back.historyIndex === 2, "history.back did not pop", back);
      await page.eval(() => history.forward());
      await delay(600);
      const forward = await page.eval(navSnapshot);
      expect(forward.screen === "browser" && forward.historyIndex === 3, "history.forward did not restore", forward);
      await page.eval(() => document.querySelector("#mobileReportsBtn").click());
      await delay(400);
      const reports = await page.eval(navSnapshot);
      expect(reports.screen === "reports" && reports.stack.endsWith("browser>reports"), "Reports did not push", reports);
      // The page records itself in Reports once its title arrives from the frame.
      await page.waitUntil(() => document.querySelector(".report-row [data-report-action=open]"), 8000);
      await page.eval(() => document.querySelector(".report-row [data-report-action=open]").click());
      await delay(800);
      const unwound = await page.eval(navSnapshot);
      expect(unwound.screen === "browser" && unwound.stack === "connect>sessions>chat>browser", "opening a report did not unwind to the Browser", unwound);
      for (const expected of ["chat", "sessions", "connect"]) {
        await page.eval(() => history.back());
        await delay(600);
        const nav = await page.eval(navSnapshot);
        expect(nav.screen === expected, `history.back did not reach ${expected}`, nav);
      }
      const bottom = await page.eval(navSnapshot);
      expect(bottom.stack === "connect" && bottom.historyIndex === 0, "stack did not end at the base", bottom);
      return bottom;
    });
  } finally {
    const issues = page.issues.slice();
    await page.close();
    return issues;
  }
}

// ---- Run ----------------------------------------------------------------------
let pageIssues = [];
try {
  if (!cdpUrl) {
    await startLocalChrome();
  }
  pageIssues = pageIssues.concat(await desktopChecks());
  pageIssues = pageIssues.concat(await phoneChecks());
} catch (error) {
  results.push({ name: "harness", ok: false, detail: error.stack || error.message });
} finally {
  if (chrome) {
    chrome.kill("SIGTERM");
    await delay(500);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.detail ? `  ${result.detail}` : ""}`);
}
const knownNoise = /favicon|ERR_BLOCKED_BY_CLIENT|401 \(Unauthorized\)/;
const issues = pageIssues.filter((issue) => !knownNoise.test(issue));
for (const issue of issues) {
  console.log(`page ${issue}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed${issues.length ? `, ${issues.length} page issue(s)` : ""}`);
process.exitCode = failed || issues.length ? 1 : 0;
