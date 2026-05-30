import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const port = 9333 + Math.floor(Math.random() * 1000);
const userDataDir = `/tmp/kitty-remote-deck-chrome-${process.pid}`;
const issues = [];
let chrome;

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function waitForChrome() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/list`);
    } catch (error) {
      await delay(100);
    }
  }
  throw new Error("Chrome DevTools endpoint did not become ready.");
}

async function findChromeBinary() {
  for (const candidate of chromeCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      // Try the next common browser location.
    }
  }

  throw new Error("Chrome smoke requires Chrome/Chromium. Set CHROME_BIN to the browser executable.");
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = [];
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result || {});
      }
      return;
    }

    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
      issues.push(`${message.params.type}: ${message.params.args.map((arg) => arg.value || arg.description || "").join(" ")}`);
    }
    if (message.method === "Runtime.exceptionThrown") {
      issues.push(`exception: ${message.params.exceptionDetails.text}`);
    }

    for (const listener of listeners) {
      listener(message);
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    waitFor(method, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = listeners.indexOf(handler);
          if (index >= 0) listeners.splice(index, 1);
          reject(new Error(`Timed out waiting for ${method}.`));
        }, timeoutMs);
        function handler(message) {
          if (message.method !== method) {
            return;
          }
          clearTimeout(timer);
          const index = listeners.indexOf(handler);
          if (index >= 0) listeners.splice(index, 1);
          resolve(message.params || {});
        }
        listeners.push(handler);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function dispatchTap(client, x, y) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 3, radiusY: 3, force: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await delay(150);
}

async function dispatchTouchDrag(client, x, startY, endY) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: startY, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: (startY + endY) / 2, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: endY, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await delay(250);
}

async function waitForExpression(client, expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function navigate(client) {
  const loadEvent = client.waitFor("Page.loadEventFired");
  await client.send("Page.navigate", { url: "http://localhost:3040" });
  await loadEvent;
  await waitForExpression(client, "document.readyState === 'complete' && document.querySelector('.activity-bar')");
}

async function runMobileChatViewport(client, width, height, label) {
  const mobileFlow = await evaluate(
    client,
    `(async () => {
      const rect = (selector) => {
        const item = document.querySelector(selector).getBoundingClientRect();
        return { width: Math.round(item.width), height: Math.round(item.height), top: Math.round(item.top), bottom: Math.round(item.bottom) };
      };
      const display = (selector) => getComputedStyle(document.querySelector(selector)).display;
      const point = (x, y) => {
        const item = document.elementFromPoint(x, y);
        return item ? { tag: item.tagName, id: item.id, className: String(item.className) } : null;
      };
      const shell = document.querySelector('#appShell');
      setAuthState(true, { label: 'smoke' });
      setMobileScreen('connect');
      window.__touchClicks = [];
      document.addEventListener('click', (event) => {
        window.__touchClicks.push({
          id: event.target.id,
          tag: event.target.tagName,
          className: String(event.target.className)
        });
      }, true);
      state.previewVisible = true;
      state.previewPinned = true;
      state.previewUrl = 'https://example.com/persisted.html';
      applyUiState();
      const connectButtonRect = document.querySelector('#mobileConnectTargetBtn').getBoundingClientRect();
      const previewBlocked = {
        previewVisible: shell.classList.contains('preview-open'),
        previewDisplay: display('#previewDrawer'),
        hitAtConnectButton: point(connectButtonRect.left + connectButtonRect.width / 2, connectButtonRect.top + connectButtonRect.height / 2)
      };
      setMobileScreen('connect');
      const actionOrder = Array.from(document.querySelectorAll('.summary-actions > button'))
        .map((button) => ({
          id: button.id,
          left: button.getBoundingClientRect().left
        }))
        .sort((a, b) => a.left - b.left)
        .map((item) => item.id);

      const initial = {
        mobileScreen: state.mobileScreen,
        connectClass: shell.classList.contains('mobile-screen-connect'),
        sshHidden: document.querySelector('#sshSidebarView').hidden,
        sessionsHidden: document.querySelector('#sessionsSidebarView').hidden,
        topbarDisplay: display('.topbar'),
        statusDisplay: display('.status-bar'),
        activityDisplay: display('.activity-bar'),
        sidebar: rect('.primary-sidebar'),
        editorDisplay: display('.editor-region'),
        mobileConnectDisplay: display('#mobileConnectTargetBtn'),
        connectButtonCenter: {
          x: connectButtonRect.left + connectButtonRect.width / 2,
          y: connectButtonRect.top + connectButtonRect.height / 2
        },
        actionOrder,
        previewBlocked
      };

      state.selectedTargetId = '';
      state.sessionTree = [
        {
          id: 1,
          is_focused: true,
          tabs: [
            {
              id: 11,
              title: 'Main',
              layout: 'stack',
              windows: [
                { id: 1234, title: 'Codex', cwd: '/workspace/kitty-remote-deck', is_active: true, is_focused: true, at_prompt: true, foreground_processes: [{ cmdline: ['codex'] }] },
                { id: 2345, title: 'Server', cwd: '/workspace/server', is_active: false, is_focused: false, at_prompt: false, foreground_processes: [{ cmdline: ['node', 'server.js'] }] }
              ]
            }
          ]
        }
      ];
      state.flatWindows = flattenWindows(state.sessionTree);
      state.selectedWindowId = null;
      setMobileScreen('sessions');
      renderSessions();

      const sessions = {
        mobileScreen: state.mobileScreen,
        sessionsClass: shell.classList.contains('mobile-screen-sessions'),
        sshHidden: document.querySelector('#sshSidebarView').hidden,
        sessionsHidden: document.querySelector('#sessionsSidebarView').hidden,
        sidebar: rect('.primary-sidebar'),
        editorDisplay: display('.editor-region'),
        paneItems: document.querySelectorAll('[data-window-id]').length,
        backToConnectDisplay: display('#mobileBackToConnectBtn')
      };

      await selectWindow(2345);
      renderScreenText('line 1\\\\nline 2 https://example.com/mobile.html');
      const chatBeforeWide = {
        mobileScreen: state.mobileScreen,
        chatClass: shell.classList.contains('mobile-screen-chat'),
        sidebarDisplay: display('.primary-sidebar'),
        editorDisplay: display('.editor-region'),
        editor: rect('.editor-region'),
        screen: rect('#screenOutput'),
        panel: rect('.bottom-panel'),
        input: rect('#sendTextInput'),
        actions: rect('.console-actions'),
        backToSessionsDisplay: display('#mobileBackToSessionsBtn'),
        terminalLinks: Array.from(document.querySelectorAll('#screenOutput [data-preview-url]')).map((link) => link.dataset.previewUrl),
        selectedPane: state.selectedWindowId
      };

      document.querySelector('#mobileTerminalWidthBtn').click();
      const wide = {
        classEnabled: shell.classList.contains('mobile-terminal-wide'),
        whiteSpace: getComputedStyle(document.querySelector('#screenOutput')).whiteSpace,
        buttonText: document.querySelector('#mobileTerminalWidthBtn').textContent.trim()
      };
      document.querySelector('#mobileTerminalWidthBtn').click();

      const historyBeforeBrowserBack = history.state?.krdMobileScreen || '';
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterBrowserBack = {
        mobileScreen: state.mobileScreen,
        sessionsClass: shell.classList.contains('mobile-screen-sessions'),
        editorDisplay: display('.editor-region'),
        historyScreen: history.state?.krdMobileScreen || ''
      };

      await selectWindow(2345);
      renderScreenText('line 1\\\\nline 2 https://example.com/mobile.html');

      document.querySelector('#mobileBackToSessionsBtn').click();
      const afterBack = {
        mobileScreen: state.mobileScreen,
        sessionsClass: shell.classList.contains('mobile-screen-sessions'),
        sidebarDisplay: display('.primary-sidebar'),
        editorDisplay: display('.editor-region'),
        historyScreen: history.state?.krdMobileScreen || ''
      };

      document.querySelector('#mobileBackToConnectBtn').click();
      const afterConnectBack = {
        mobileScreen: state.mobileScreen,
        connectClass: shell.classList.contains('mobile-screen-connect'),
        sshHidden: document.querySelector('#sshSidebarView').hidden,
        sessionsHidden: document.querySelector('#sessionsSidebarView').hidden
      };

      const originalConnectSelectedTarget = connectSelectedTarget;
      const autoConnectCalls = [];
      connectSelectedTarget = async (options = {}) => {
        autoConnectCalls.push(options.source || 'manual');
        setMobileScreen('sessions');
      };

      state.authenticated = true;
      state.selectedTargetId = 'local';
      setMobileScreen('connect', { history: 'replace' });
      scheduleMobileAutoConnect({ resetSuppression: true });
      await new Promise((resolve) => setTimeout(resolve, MOBILE_AUTO_CONNECT_DELAY_MS + 80));
      const autoConnectInitial = {
        calls: [...autoConnectCalls],
        mobileScreen: state.mobileScreen
      };

      setMobileScreen('sessions', { history: 'replace' });
      handleMobileBack('connect');
      scheduleMobileAutoConnect();
      await new Promise((resolve) => setTimeout(resolve, MOBILE_AUTO_CONNECT_DELAY_MS + 80));
      const autoConnectAfterBack = {
        calls: [...autoConnectCalls],
        mobileScreen: state.mobileScreen
      };

      connectSelectedTarget = originalConnectSelectedTarget;
      state.selectedTargetId = '';
      cancelMobileAutoConnect({ suppress: true });
      setMobileScreen('connect', { history: 'replace' });

      const originalApiFetch = apiFetch;
      const originalRefreshScreen = refreshScreen;
      const composerCalls = [];
      apiFetch = async (url, options = {}) => {
        if (url === '/api/send-text' || url === '/api/send-key') {
          composerCalls.push({
            url,
            body: options.body ? JSON.parse(options.body) : {}
          });
          return { ok: true, data: {} };
        }
        return originalApiFetch(url, options);
      };
      refreshScreen = async () => {};

      state.selectedTargetId = 'local';
      state.selectedWindowId = 2345;
      state.selectedSocket = '/tmp/kitty-smoke.sock';
      const composer = document.querySelector('#sendTextInput');

      composer.value = 'line 1\\nline 2';
      await sendComposerShortcut();
      const multilineComposer = {
        calls: composerCalls.slice(),
        valueAfter: composer.value
      };

      composer.value = '\\n';
      await sendComposerShortcut();
      const newlineOnlyComposer = {
        calls: composerCalls.slice(multilineComposer.calls.length),
        valueAfter: composer.value
      };

      composer.value = '';
      await sendComposerShortcut();
      const emptyComposer = {
        calls: composerCalls.slice(multilineComposer.calls.length + newlineOnlyComposer.calls.length),
        valueAfter: composer.value
      };

      apiFetch = originalApiFetch;
      refreshScreen = originalRefreshScreen;
      state.selectedTargetId = '';
      state.selectedWindowId = null;
      state.selectedSocket = '';

      return {
        label: ${JSON.stringify(label)},
        title: document.title,
        shell: rect('#appShell'),
        workbench: rect('.workbench'),
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        initial,
        sessions,
        chatBeforeWide,
        wide,
        historyBeforeBrowserBack,
        afterBrowserBack,
        afterBack,
        afterConnectBack,
        autoConnectInitial,
        autoConnectAfterBack,
        composerEnter: {
          multiline: multilineComposer,
          newlineOnly: newlineOnlyComposer,
          empty: emptyComposer
        }
      };
    })()`
  );

  await dispatchTap(client, mobileFlow.initial.connectButtonCenter.x, mobileFlow.initial.connectButtonCenter.y);
  mobileFlow.touchTap = await evaluate(
    client,
    `(() => ({
      clicks: window.__touchClicks,
      status: document.querySelector('#statusMessage').textContent,
      activeElement: document.activeElement?.id || ''
    }))()`
  );
  mobileFlow.sessionTouchSetup = await evaluate(
    client,
    `(() => {
      state.sessionTree = [
        {
          id: 1,
          is_focused: true,
          tabs: [
            {
              id: 11,
              title: 'Touch list',
              layout: 'stack',
              windows: Array.from({ length: 28 }, (_, index) => ({
                id: 3000 + index,
                title: 'Pane ' + index,
                cwd: '/workspace/' + index,
                is_active: index === 8,
                is_focused: index === 8,
                at_prompt: true,
                foreground_processes: [{ cmdline: ['shell'] }]
              }))
            }
          ]
        }
      ];
      state.flatWindows = flattenWindows(state.sessionTree);
      state.selectedWindowId = null;
      setMobileScreen('sessions');
      renderSessions();
      const scroller = document.querySelector('#sessionsSidebarView');
      const target = document.querySelector('[data-window-id="3008"]').getBoundingClientRect();
      const tree = document.querySelector('#sessionTree').getBoundingClientRect();
      const scrollRect = scroller.getBoundingClientRect();
      return {
        paneCenter: { x: target.left + target.width / 2, y: target.top + target.height / 2 },
        drag: { x: tree.left + tree.width / 2, startY: scrollRect.bottom - 22, endY: scrollRect.top + 40 },
        initialScrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight
      };
    })()`
  );
  await dispatchTouchDrag(
    client,
    mobileFlow.sessionTouchSetup.drag.x,
    mobileFlow.sessionTouchSetup.drag.startY,
    mobileFlow.sessionTouchSetup.drag.endY
  );
  mobileFlow.sessionTouchScroll = await evaluate(
    client,
    `(() => {
      const candidates = Array.from(document.querySelectorAll('[data-window-id]'))
        .map((item) => {
          const rect = item.getBoundingClientRect();
          return {
            id: Number(item.dataset.windowId),
            center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            visible: rect.top >= 0 && rect.bottom <= window.innerHeight
          };
        })
        .filter((item) => item.visible);
      const candidate = candidates[Math.min(2, Math.max(0, candidates.length - 1))] || candidates[0];
      const hit = candidate
        ? document.elementFromPoint(candidate.center.x, candidate.center.y)?.closest('[data-window-id]')
        : null;
      const target = hit
        ? {
            id: Number(hit.dataset.windowId),
            center: candidate.center,
            visible: true
          }
        : candidate;
      return {
        scrollTop: document.querySelector('#sessionsSidebarView').scrollTop,
        tapTarget: target || null
      };
    })()`
  );
  await dispatchTap(client, mobileFlow.sessionTouchScroll.tapTarget.center.x, mobileFlow.sessionTouchScroll.tapTarget.center.y);
  mobileFlow.sessionPaneTap = await evaluate(
    client,
    `(() => ({
      mobileScreen: state.mobileScreen,
      selectedPane: state.selectedWindowId,
      chatClass: document.querySelector('#appShell').classList.contains('mobile-screen-chat')
    }))()`
  );

  const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
  const screenshotPath = `/tmp/kitty-remote-deck-workbench-${label}.png`;
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  mobileFlow.screenshot = screenshotPath;

  if (
    mobileFlow.title !== "Kitty Remote Deck" ||
    Math.abs(mobileFlow.shell.height - height) > 3 ||
    mobileFlow.pageWidth > mobileFlow.viewportWidth + 2 ||
    mobileFlow.initial.mobileScreen !== "connect" ||
    mobileFlow.initial.connectClass !== true ||
    mobileFlow.initial.sshHidden !== false ||
    mobileFlow.initial.sessionsHidden !== true ||
    mobileFlow.initial.topbarDisplay !== "none" ||
    mobileFlow.initial.statusDisplay !== "none" ||
    mobileFlow.initial.activityDisplay !== "none" ||
    mobileFlow.initial.sidebar.width < width - 4 ||
    mobileFlow.initial.editorDisplay !== "none" ||
    mobileFlow.initial.mobileConnectDisplay === "none" ||
    mobileFlow.initial.actionOrder.join(",") !== "newTargetBtn,testTargetBtn,mobileConnectTargetBtn" ||
    mobileFlow.initial.previewBlocked.previewVisible !== true ||
    mobileFlow.initial.previewBlocked.previewDisplay !== "none" ||
    mobileFlow.initial.previewBlocked.hitAtConnectButton?.id !== "mobileConnectTargetBtn" ||
    mobileFlow.sessions.mobileScreen !== "sessions" ||
    mobileFlow.sessions.sessionsClass !== true ||
    mobileFlow.sessions.sshHidden !== true ||
    mobileFlow.sessions.sessionsHidden !== false ||
    mobileFlow.sessions.sidebar.width < width - 4 ||
    mobileFlow.sessions.editorDisplay !== "none" ||
    mobileFlow.sessions.paneItems !== 2 ||
    mobileFlow.sessions.backToConnectDisplay === "none" ||
    mobileFlow.chatBeforeWide.mobileScreen !== "chat" ||
    mobileFlow.chatBeforeWide.chatClass !== true ||
    mobileFlow.chatBeforeWide.sidebarDisplay !== "none" ||
    mobileFlow.chatBeforeWide.editorDisplay !== "grid" ||
    mobileFlow.chatBeforeWide.editor.width < width - 4 ||
    mobileFlow.chatBeforeWide.screen.height < Math.max(360, height * 0.55) ||
    mobileFlow.chatBeforeWide.panel.height < 110 ||
    mobileFlow.chatBeforeWide.input.bottom > mobileFlow.chatBeforeWide.actions.top ||
    mobileFlow.chatBeforeWide.actions.bottom > mobileFlow.chatBeforeWide.panel.bottom + 1 ||
    mobileFlow.chatBeforeWide.backToSessionsDisplay === "none" ||
    mobileFlow.chatBeforeWide.selectedPane !== 2345 ||
    !mobileFlow.chatBeforeWide.terminalLinks.includes("https://example.com/mobile.html") ||
    mobileFlow.wide.classEnabled !== true ||
    mobileFlow.wide.whiteSpace !== "pre" ||
    mobileFlow.wide.buttonText !== "Wide" ||
    mobileFlow.historyBeforeBrowserBack !== "chat" ||
    mobileFlow.afterBrowserBack.mobileScreen !== "sessions" ||
    mobileFlow.afterBrowserBack.sessionsClass !== true ||
    mobileFlow.afterBrowserBack.editorDisplay !== "none" ||
    mobileFlow.afterBack.mobileScreen !== "sessions" ||
    mobileFlow.afterBack.sessionsClass !== true ||
    mobileFlow.afterBack.sidebarDisplay === "none" ||
    mobileFlow.afterBack.editorDisplay !== "none" ||
    mobileFlow.afterBack.historyScreen !== "sessions" ||
    mobileFlow.afterConnectBack.mobileScreen !== "connect" ||
    mobileFlow.afterConnectBack.connectClass !== true ||
    mobileFlow.afterConnectBack.sshHidden !== false ||
    mobileFlow.afterConnectBack.sessionsHidden !== true ||
    mobileFlow.autoConnectInitial.calls.join(",") !== "auto" ||
    mobileFlow.autoConnectInitial.mobileScreen !== "sessions" ||
    mobileFlow.autoConnectAfterBack.calls.join(",") !== "auto" ||
    mobileFlow.autoConnectAfterBack.mobileScreen !== "connect" ||
    mobileFlow.composerEnter.multiline.calls.length !== 1 ||
    mobileFlow.composerEnter.multiline.calls[0].url !== "/api/send-text" ||
    mobileFlow.composerEnter.multiline.calls[0].body.text !== "line 1\nline 2" ||
    mobileFlow.composerEnter.multiline.calls[0].body.appendNewline !== true ||
    mobileFlow.composerEnter.multiline.valueAfter !== "" ||
    mobileFlow.composerEnter.newlineOnly.calls.length !== 1 ||
    mobileFlow.composerEnter.newlineOnly.calls[0].url !== "/api/send-text" ||
    mobileFlow.composerEnter.newlineOnly.calls[0].body.text !== "\n" ||
    mobileFlow.composerEnter.newlineOnly.calls[0].body.appendNewline !== true ||
    mobileFlow.composerEnter.newlineOnly.valueAfter !== "" ||
    mobileFlow.composerEnter.empty.calls.length !== 1 ||
    mobileFlow.composerEnter.empty.calls[0].url !== "/api/send-key" ||
    mobileFlow.composerEnter.empty.calls[0].body.key !== "enter" ||
    !mobileFlow.touchTap.clicks.some((item) => item.id === "mobileConnectTargetBtn") ||
    !mobileFlow.touchTap.status.includes("先保存一个连接目标") ||
    mobileFlow.sessionTouchSetup.scrollHeight <= mobileFlow.sessionTouchSetup.clientHeight ||
    mobileFlow.sessionTouchScroll.scrollTop <= mobileFlow.sessionTouchSetup.initialScrollTop ||
    !mobileFlow.sessionTouchScroll.tapTarget ||
    mobileFlow.sessionPaneTap.mobileScreen !== "chat" ||
    mobileFlow.sessionPaneTap.chatClass !== true ||
    mobileFlow.sessionPaneTap.selectedPane !== mobileFlow.sessionTouchScroll.tapTarget.id
  ) {
    throw new Error(`Mobile chat layout failed: ${JSON.stringify(mobileFlow, null, 2)}`);
  }

  return mobileFlow;
}

async function runViewport(client, width, height, label) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate(client);
  await evaluate(client, "localStorage.clear(); true");
  await navigate(client);

  await waitForExpression(client, "document.querySelector('h1')?.textContent.includes('Remote Kitty Workbench')");
  const authInitial = await evaluate(
    client,
    `(() => ({
      gateHidden: document.querySelector('#authGate').hidden,
      status: document.querySelector('#authStatusText').textContent,
      meta: document.querySelector('#authDeviceMeta').textContent
    }))()`
  );
  await evaluate(client, "setAuthState(true, { label: 'smoke', tokenPreview: 'krd_smoke...' }); true");
  await waitForExpression(client, "document.querySelector('#sshSidebarView') && !document.querySelector('#sshSidebarView').hidden");
  if (label === "mobile") {
    return runMobileChatViewport(client, width, height, label);
  }
  await evaluate(client, "document.querySelector('#showSshViewBtn').click(); true");
  await waitForExpression(client, "document.querySelector('#appShell').classList.contains('sidebar-hidden')");
  const hiddenMetrics = await evaluate(
    client,
    `(() => {
      const rect = (selector) => {
        const item = document.querySelector(selector).getBoundingClientRect();
        return { width: Math.round(item.width), height: Math.round(item.height), top: Math.round(item.top), bottom: Math.round(item.bottom) };
      };
      return {
        sidebarHidden: document.querySelector('#appShell').classList.contains('sidebar-hidden'),
        sidebar: rect('.primary-sidebar'),
        editor: rect('.editor-region')
      };
    })()`
  );

  if (
    hiddenMetrics.sidebarHidden !== true ||
    (label !== "mobile" && hiddenMetrics.sidebar.width !== 0) ||
    hiddenMetrics.editor.width < width - (label === "mobile" ? 18 : 80)
  ) {
    throw new Error(`Sidebar hidden layout failed for ${label}: ${JSON.stringify(hiddenMetrics, null, 2)}`);
  }

  await evaluate(client, "document.querySelector('#showSessionsViewBtn').click(); true");
  await waitForExpression(client, "!document.querySelector('#appShell').classList.contains('sidebar-hidden')");
  const defaultMetrics = await evaluate(
    client,
    `(() => {
      const rect = (selector) => {
        const item = document.querySelector(selector).getBoundingClientRect();
        return { width: Math.round(item.width), height: Math.round(item.height), top: Math.round(item.top), bottom: Math.round(item.bottom) };
      };
      return {
        resizeEnabled: document.querySelector('#appShell').classList.contains('resize-enabled'),
        editor: rect('.editor-region'),
        screen: rect('#screenOutput'),
        panel: rect('.bottom-panel'),
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      };
    })()`
  );

  if (
    defaultMetrics.resizeEnabled !== false ||
    defaultMetrics.editor.width < Math.max(160, width * 0.25) ||
    Math.abs(defaultMetrics.screen.width - defaultMetrics.editor.width) > 16 ||
    Math.abs(defaultMetrics.panel.width - defaultMetrics.editor.width) > 16 ||
    defaultMetrics.screen.height < Math.max(220, height * 0.35) ||
    defaultMetrics.panel.height < 140 ||
    defaultMetrics.pageWidth > defaultMetrics.viewportWidth + 2
  ) {
    throw new Error(`Default resize-off layout failed for ${label}: ${JSON.stringify(defaultMetrics, null, 2)}`);
  }

  await evaluate(client, "document.querySelector('#showSshViewBtn').click(); true");
  await waitForExpression(client, "document.querySelector('#sshSidebarView') && !document.querySelector('#sshSidebarView').hidden");
  const urlActivityRemoved = await evaluate(client, "!document.querySelector('#showUrlViewBtn') && !document.querySelector('#urlSidebarView')");
  await evaluate(client, "document.querySelector('#showSessionsViewBtn').click(); true");
  await waitForExpression(client, "document.querySelector('#sessionsSidebarView') && !document.querySelector('#sessionsSidebarView').hidden");

  await evaluate(client, "document.querySelector('#allTextModeBtn').click(); true");
  await waitForExpression(client, "document.querySelector('#allTextModeBtn').classList.contains('active')");
  const allModeWheelCanceled = await evaluate(
    client,
    `(() => {
      const event = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
      return !document.querySelector('#screenOutput').dispatchEvent(event);
    })()`
  );
  const allModeHistoryPause = await evaluate(
    client,
    `(() => {
      const output = document.querySelector('#screenOutput');
      output.textContent = Array.from({ length: 240 }, (_, index) => 'history line ' + index).join('\\n');
      output.scrollTop = 0;
      output.dispatchEvent(new Event('scroll', { bubbles: true }));
      return document.querySelector('#statusMessage').textContent.includes('All auto refresh paused');
    })()`
  );
  await evaluate(client, "document.querySelector('#screenModeBtn').click(); true");
  await waitForExpression(client, "document.querySelector('#screenModeBtn').classList.contains('active')");
  const terminalLinks = await evaluate(
    client,
    `(() => {
      window.renderScreenText('open https://example.com/report.html and file:///tmp/krd-report.html.');
      return Array.from(document.querySelectorAll('#screenOutput [data-preview-url]')).map((link) => link.dataset.previewUrl);
    })()`
  );
  const mobileSwitcherWorked = await evaluate(
    client,
    `(async () => {
      const previousTargetId = state.selectedTargetId;
      const previousFlatWindows = state.flatWindows;
      const previousWindowId = state.selectedWindowId;
      state.selectedTargetId = '';
      state.flatWindows = [
        { id: 1234, title: 'first pane', tabId: 1, tabTitle: 'one', cwd: '/workspace' },
        { id: 2345, title: 'second pane', tabId: 2, tabTitle: 'two', cwd: '/workspace/app' }
      ];
      state.selectedWindowId = 1234;
      renderMobilePaneSwitcher();
      const switcher = document.querySelector('#mobilePaneSwitcher');
      const second = switcher.querySelector('[data-mobile-window-id="2345"]');
      second.click();
      await Promise.resolve();
      const result = {
        display: getComputedStyle(switcher).display,
        hidden: switcher.hidden,
        labels: Array.from(switcher.querySelectorAll('.mobile-pane-tab')).map((item) => item.textContent.trim()),
        selectedWindowId: state.selectedWindowId,
        selectedLabel: switcher.querySelector('.mobile-pane-tab.selected')?.textContent.trim() || ''
      };
      state.selectedTargetId = previousTargetId;
      state.flatWindows = previousFlatWindows;
      state.selectedWindowId = previousWindowId;
      renderMobilePaneSwitcher();
      return result;
    })()`
  );
  const previewDrawerWorked = await evaluate(
    client,
    `(async () => {
      state.targets = [{ id: 'local', name: 'Local Kitty' }];
      state.selectedTargetId = 'local';
      await loadUrlPreview('file:///tmp/krd-report.html');
      await loadUrlPreview('/tmp/krd-second.html');
      const opened = {
        previewOpen: document.querySelector('#appShell').classList.contains('preview-open'),
        drawerHidden: document.querySelector('#previewDrawer').getAttribute('aria-hidden'),
        frameSrc: document.querySelector('#urlPreviewFrame').getAttribute('src'),
        address: document.querySelector('#previewAddress').textContent,
        addressInput: document.querySelector('#browserAddressInput').value,
        backEnabledAfterSecondUrl: document.querySelector('#browserBackBtn').disabled === false,
        forwardDisabledAfterSecondUrl: document.querySelector('#browserForwardBtn').disabled === true,
        historyCountAfterSecondUrl: document.querySelector('#browserHistorySelect').options.length
      };
      document.querySelector('#browserBackBtn').click();
      opened.backFrameSrc = document.querySelector('#urlPreviewFrame').getAttribute('src');
      opened.backAddressInput = document.querySelector('#browserAddressInput').value;
      opened.forwardEnabledAfterBack = document.querySelector('#browserForwardBtn').disabled === false;
      document.querySelector('#browserForwardBtn').click();
      opened.forwardFrameSrc = document.querySelector('#urlPreviewFrame').getAttribute('src');
      opened.forwardAddressInput = document.querySelector('#browserAddressInput').value;
      const history = document.querySelector('#browserHistorySelect');
      history.value = '0';
      history.dispatchEvent(new Event('change', { bubbles: true }));
      opened.historyJumpInput = document.querySelector('#browserAddressInput').value;
      handleBrowserMessage({
        source: document.querySelector('#urlPreviewFrame').contentWindow,
        data: {
          source: 'kitty-remote-deck-browser',
          type: 'browser:navigate',
          targetId: 'local',
          url: 'https://example.com/from-frame.html'
        }
      });
      opened.frameNavigateInput = document.querySelector('#browserAddressInput').value;
      opened.frameNavigateSrc = document.querySelector('#urlPreviewFrame').getAttribute('src');
      state.resizeEnabled = true;
      applyUiState();
      opened.browserWidthBeforeResize = Math.round(document.querySelector('#previewDrawer').getBoundingClientRect().width);
      startResize('browser', { clientX: 500, clientY: 0, preventDefault() {} });
      handleResizeMove({ clientX: 580, clientY: 0 });
      stopResize();
      opened.browserWidthAfterResize = Math.round(document.querySelector('#previewDrawer').getBoundingClientRect().width);
      state.resizeEnabled = false;
      applyUiState();
      opened.editorWidthBeforePin = Math.round(document.querySelector('.editor-region').getBoundingClientRect().width);
      document.querySelector('#pinBrowserBtn').click();
      opened.pinned = document.querySelector('#appShell').classList.contains('browser-pinned');
      opened.pinPressed = document.querySelector('#pinBrowserBtn').getAttribute('aria-pressed');
      opened.editorWidthPinned = Math.round(document.querySelector('.editor-region').getBoundingClientRect().width);
      document.querySelector('.editor-region').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      opened.pinnedStillOpen = document.querySelector('#appShell').classList.contains('preview-open');
      document.querySelector('#pinBrowserBtn').click();
      document.querySelector('.editor-region').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      opened.unpinnedAutoClosed = !document.querySelector('#appShell').classList.contains('preview-open');
      opened.closed = opened.unpinnedAutoClosed;
      opened.reopenVisible = document.querySelector('#reopenPreviewBtn').hidden === false;
      document.querySelector('#reopenPreviewBtn').click();
      opened.reopened = document.querySelector('#appShell').classList.contains('preview-open');
      opened.reopenedFrameSrc = document.querySelector('#urlPreviewFrame').getAttribute('src');
      return opened;
    })()`
  );
  const screenModePreservedScroll = await evaluate(
    client,
    `(() => {
      const output = document.querySelector('#screenOutput');
      output.textContent = Array.from({ length: 180 }, (_, index) => 'screen line ' + index).join('\\n');
      output.scrollTop = Math.max(64, output.scrollHeight - output.clientHeight - 40);
      const before = output.scrollTop;
      window.renderScreenText(output.textContent + '\\nnew line from refresh');
      return { before, after: output.scrollTop };
    })()`
  );
  if (screenModePreservedScroll.before > 0 && screenModePreservedScroll.after < screenModePreservedScroll.before - 4) {
    throw new Error(`Screen mode local scroll was reset during refresh for ${label}: ${JSON.stringify(screenModePreservedScroll)}`);
  }
  const wheelCanceled = await evaluate(
    client,
    `(() => {
      const event = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
      return !document.querySelector('#screenOutput').dispatchEvent(event);
    })()`
  );
  await waitForExpression(client, "document.querySelector('#statusMessage')?.textContent.includes('先选中一个 pane')");
  await evaluate(client, "document.querySelector('#sendEscBtn').click(); true");
  await waitForExpression(client, "document.querySelector('#statusMessage')?.textContent.includes('先选中一个 pane')");
  await evaluate(client, "document.querySelector('#resizeToggle').click(); true");
  await waitForExpression(client, "document.querySelector('#appShell').classList.contains('resize-enabled')");
  await evaluate(
    client,
    "(() => { const select = document.querySelector('#themeSelect'); select.value = 'light'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()"
  );
  await waitForExpression(client, "document.documentElement.dataset.theme === 'light'");
  await evaluate(
    client,
    "(() => { const select = document.querySelector('#themeSelect'); select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()"
  );
  await waitForExpression(client, "document.documentElement.dataset.theme === 'dark'");

  const metrics = await evaluate(
    client,
    `(() => {
      const rect = (selector) => {
        const item = document.querySelector(selector).getBoundingClientRect();
        return { width: Math.round(item.width), height: Math.round(item.height), top: Math.round(item.top), bottom: Math.round(item.bottom) };
      };
      return {
        label: ${JSON.stringify(label)},
        title: document.title,
        authInitial: ${JSON.stringify(authInitial)},
        hiddenToggle: ${JSON.stringify(hiddenMetrics)},
        defaultResizeOff: ${JSON.stringify(defaultMetrics)},
        shell: rect('#appShell'),
        workbench: rect('.workbench'),
        activity: rect('.activity-bar'),
        sidebar: rect('.primary-sidebar'),
        editor: rect('.editor-region'),
        screen: rect('#screenOutput'),
        panel: rect('.bottom-panel'),
        status: rect('.status-bar'),
        sshHidden: document.querySelector('#sshSidebarView').hidden,
        sessionsHidden: document.querySelector('#sessionsSidebarView').hidden,
        resizeEnabled: document.querySelector('#appShell').classList.contains('resize-enabled'),
        theme: document.documentElement.dataset.theme,
        themeCycleWorked: localStorage.getItem('kitty-remote-deck-ui')?.includes('"uiTheme":"dark"') || false,
        screenModeStored: localStorage.getItem('kitty-remote-deck-ui')?.includes('"screenExtent":"screen"') || false,
        allModeWheelCanceled: ${JSON.stringify(allModeWheelCanceled)},
        allModeHistoryPause: ${JSON.stringify(allModeHistoryPause)},
        urlActivityRemoved: ${JSON.stringify(urlActivityRemoved)},
        terminalLinks: ${JSON.stringify(terminalLinks)},
        mobileSwitcherWorked: ${JSON.stringify(mobileSwitcherWorked)},
        previewDrawerWorked: ${JSON.stringify(previewDrawerWorked)},
        wheelCanceled: ${JSON.stringify(wheelCanceled)},
        escClickStatus: document.querySelector('#statusMessage').textContent,
        ctrlDText: document.querySelector('#sendCtrlDBtn').textContent,
        fontSizeText: document.querySelector('#fontSizeValue').textContent,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    })()`
  );

  const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
  const screenshotPath = `/tmp/kitty-remote-deck-workbench-${label}.png`;
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  metrics.screenshot = screenshotPath;

  if (
    metrics.title !== "Kitty Remote Deck" ||
    metrics.authInitial.gateHidden !== false ||
    !/认证|登录|token/.test(metrics.authInitial.status) ||
    Math.abs(metrics.shell.height - height) > 3 ||
    metrics.editor.height <= metrics.panel.height ||
    metrics.screen.top < metrics.workbench.top - 2 ||
    Math.abs(metrics.screen.width - metrics.editor.width) > 16 ||
    Math.abs(metrics.panel.width - metrics.editor.width) > 16 ||
    metrics.screen.height < Math.max(220, height * 0.35) ||
    metrics.panel.height < 140 ||
    metrics.pageWidth > metrics.viewportWidth + 2 ||
    metrics.status.height < 18 ||
    metrics.sshHidden !== true ||
    metrics.sessionsHidden !== false ||
    metrics.resizeEnabled !== true ||
    metrics.theme !== "dark" ||
    metrics.themeCycleWorked !== true ||
    metrics.screenModeStored !== true ||
    metrics.allModeWheelCanceled !== false ||
    metrics.allModeHistoryPause !== true ||
    metrics.urlActivityRemoved !== true ||
    metrics.terminalLinks.length !== 2 ||
    !metrics.terminalLinks.includes("https://example.com/report.html") ||
    !metrics.terminalLinks.includes("file:///tmp/krd-report.html") ||
    metrics.mobileSwitcherWorked.labels.length !== 2 ||
    !metrics.mobileSwitcherWorked.labels.includes("ID 1234") ||
    !metrics.mobileSwitcherWorked.labels.includes("ID 2345") ||
    metrics.mobileSwitcherWorked.selectedWindowId !== 2345 ||
    metrics.mobileSwitcherWorked.selectedLabel !== "ID 2345" ||
    (metrics.label !== "mobile" && metrics.mobileSwitcherWorked.display !== "none") ||
    metrics.previewDrawerWorked.previewOpen !== true ||
    metrics.previewDrawerWorked.drawerHidden !== "false" ||
    !metrics.previewDrawerWorked.frameSrc.includes("/api/url-resource?") ||
    !metrics.previewDrawerWorked.frameSrc.includes("file%3A%2F%2F%2Ftmp%2Fkrd-second.html") ||
    metrics.previewDrawerWorked.addressInput !== "file:///tmp/krd-second.html" ||
    metrics.previewDrawerWorked.backEnabledAfterSecondUrl !== true ||
    metrics.previewDrawerWorked.forwardDisabledAfterSecondUrl !== true ||
    metrics.previewDrawerWorked.historyCountAfterSecondUrl < 3 ||
    !metrics.previewDrawerWorked.backFrameSrc.includes("file%3A%2F%2F%2Ftmp%2Fkrd-report.html") ||
    metrics.previewDrawerWorked.backAddressInput !== "file:///tmp/krd-report.html" ||
    metrics.previewDrawerWorked.forwardEnabledAfterBack !== true ||
    !metrics.previewDrawerWorked.forwardFrameSrc.includes("file%3A%2F%2F%2Ftmp%2Fkrd-second.html") ||
    metrics.previewDrawerWorked.forwardAddressInput !== "file:///tmp/krd-second.html" ||
    metrics.previewDrawerWorked.historyJumpInput !== "file:///tmp/krd-report.html" ||
    !metrics.previewDrawerWorked.frameNavigateSrc.includes("https%3A%2F%2Fexample.com%2Ffrom-frame.html") ||
    metrics.previewDrawerWorked.frameNavigateInput !== "https://example.com/from-frame.html" ||
    metrics.previewDrawerWorked.browserWidthAfterResize >= metrics.previewDrawerWorked.browserWidthBeforeResize ||
    metrics.previewDrawerWorked.pinned !== true ||
    metrics.previewDrawerWorked.pinPressed !== "true" ||
    (metrics.label !== "mobile" && metrics.previewDrawerWorked.editorWidthPinned >= metrics.previewDrawerWorked.editorWidthBeforePin) ||
    (metrics.label === "mobile" && Math.abs(metrics.previewDrawerWorked.editorWidthPinned - metrics.previewDrawerWorked.editorWidthBeforePin) > 4) ||
    metrics.previewDrawerWorked.editorWidthPinned <= 0 ||
    metrics.previewDrawerWorked.pinnedStillOpen !== true ||
    metrics.previewDrawerWorked.unpinnedAutoClosed !== true ||
    metrics.previewDrawerWorked.closed !== true ||
    metrics.previewDrawerWorked.reopenVisible !== true ||
    metrics.previewDrawerWorked.reopened !== true ||
    metrics.previewDrawerWorked.reopenedFrameSrc !== metrics.previewDrawerWorked.frameNavigateSrc ||
    metrics.wheelCanceled !== true ||
    !metrics.escClickStatus.includes("先选中一个 pane") ||
    !metrics.ctrlDText.includes("Ctrl+D") ||
    metrics.fontSizeText !== "13px"
  ) {
    throw new Error(`Workbench metrics failed for ${label}: ${JSON.stringify(metrics, null, 2)}`);
  }

  return metrics;
}

try {
  const chromeBin = await findChromeBinary();
  chrome = spawn(chromeBin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ]);

  chrome.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    if (/ERROR/i.test(text) && !/dbus|ssl_client_socket|SharedImageManager::ProduceMemory/i.test(text)) {
      issues.push(text.trim());
    }
  });

  const targets = await waitForChrome();
  const pageTarget = targets.find((target) => target.type === "page") || targets[0];
  const client = createCdpClient(pageTarget.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Page.enable");

  const desktop = await runViewport(client, 1440, 900, "desktop");
  const portrait = await runViewport(client, 900, 1400, "portrait");
  const mobile = await runViewport(client, 430, 844, "mobile");
  client.close();

  const result = { desktop, portrait, mobile, issues };
  console.log(JSON.stringify(result, null, 2));

  if (issues.length > 0) {
    process.exitCode = 1;
  }
} finally {
  if (chrome) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGTERM");
    await Promise.race([exited, delay(2000)]);
  }
  await fs.rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
