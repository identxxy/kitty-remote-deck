const STORAGE_KEY = "kitty-remote-deck-ui";
const FONT_SIZE_RANGE = { min: 5, max: 18, default: 13 };
const THEME_SET = new Set(["dark", "graphite", "light"]);
const TEXT_EXTENT_SET = new Set(["screen", "all"]);
const SIDEBAR_WIDTH_RANGE = { min: 220, max: 520 };
const PANEL_HEIGHT_RANGE = { min: 150, max: 420 };
const BROWSER_WIDTH_RANGE = { min: 320, max: 900, default: 560 };
const AUTO_REFRESH_MS = 5000;
const SESSION_TREE_REFRESH_EVERY_TICKS = 3;
const ALL_TEXT_AUTO_REFRESH_EVERY_TICKS = 3;
const WHEEL_SCROLL_DEBOUNCE_MS = 70;
const WHEEL_SCROLL_MAX_LINES = 80;

const DEFAULT_TARGET_FORM = {
  name: "Local Kitty",
  transport: "local",
  sshTarget: "",
  kittyBinary: "kitty",
  socketPattern: "/tmp/kitty.sock-*",
  defaultSocket: "",
  notes: ""
};

const state = {
  authenticated: false,
  authDevice: null,
  targets: [],
  selectedTargetId: "",
  editingTargetId: "",
  selectedSocket: "",
  sessionTree: [],
  flatWindows: [],
  selectedWindowId: null,
  screenText: "",
  autoRefresh: true,
  refreshing: false,
  activeSidebarView: "ssh",
  sidebarVisible: true,
  uiFontSizePx: FONT_SIZE_RANGE.default,
  uiTheme: "dark",
  screenExtent: "screen",
  allTextFollowTail: true,
  previewVisible: false,
  previewPinned: false,
  previewUrl: "",
  previewHistory: [],
  previewHistoryIndex: -1,
  resizeEnabled: false,
  sidebarWidth: 320,
  browserWidth: BROWSER_WIDTH_RANGE.default,
  bottomPanelHeight: 230
};

const elements = {
  appShell: document.querySelector("#appShell"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authTokenInput: document.querySelector("#authTokenInput"),
  authStatusText: document.querySelector("#authStatusText"),
  authDeviceLabel: document.querySelector("#authDeviceLabel"),
  logoutBtn: document.querySelector("#logoutBtn"),
  showSshViewBtn: document.querySelector("#showSshViewBtn"),
  showSessionsViewBtn: document.querySelector("#showSessionsViewBtn"),
  sshSidebarView: document.querySelector("#sshSidebarView"),
  sessionsSidebarView: document.querySelector("#sessionsSidebarView"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  panelResizeHandle: document.querySelector("#panelResizeHandle"),
  browserResizeHandle: document.querySelector("#browserResizeHandle"),
  targetForm: document.querySelector("#targetForm"),
  reloadTargetsBtn: document.querySelector("#reloadTargetsBtn"),
  reloadSessionsBtn: document.querySelector("#reloadSessionsBtn"),
  reloadSessionTreeBtn: document.querySelector("#reloadSessionTreeBtn"),
  saveTargetBtn: document.querySelector("#saveTargetBtn"),
  testTargetBtn: document.querySelector("#testTargetBtn"),
  connectTargetBtn: document.querySelector("#connectTargetBtn"),
  newTargetBtn: document.querySelector("#newTargetBtn"),
  decreaseFontBtn: document.querySelector("#decreaseFontBtn"),
  increaseFontBtn: document.querySelector("#increaseFontBtn"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  themeSelect: document.querySelector("#themeSelect"),
  resizeToggle: document.querySelector("#resizeToggle"),
  resizeLabel: document.querySelector("#resizeLabel"),
  targetHealth: document.querySelector("#targetHealth"),
  targetStatus: document.querySelector("#targetStatus"),
  savedTargets: document.querySelector("#savedTargets"),
  targetSelect: document.querySelector("#targetSelect"),
  targetTransport: document.querySelector("#targetTransport"),
  socketSelect: document.querySelector("#socketSelect"),
  sessionSummary: document.querySelector("#sessionSummary"),
  sessionTree: document.querySelector("#sessionTree"),
  editorPane: document.querySelector("#editorPane"),
  viewerMeta: document.querySelector("#viewerMeta"),
  screenOutput: document.querySelector("#screenOutput"),
  previewDrawer: document.querySelector("#previewDrawer"),
  previewTitle: document.querySelector("#previewTitle"),
  previewAddress: document.querySelector("#previewAddress"),
  browserAddressForm: document.querySelector("#browserAddressForm"),
  browserAddressInput: document.querySelector("#browserAddressInput"),
  browserBackBtn: document.querySelector("#browserBackBtn"),
  browserForwardBtn: document.querySelector("#browserForwardBtn"),
  browserHistorySelect: document.querySelector("#browserHistorySelect"),
  browserGoBtn: document.querySelector("#browserGoBtn"),
  pinBrowserBtn: document.querySelector("#pinBrowserBtn"),
  closePreviewBtn: document.querySelector("#closePreviewBtn"),
  reopenPreviewBtn: document.querySelector("#reopenPreviewBtn"),
  urlPreviewFrame: document.querySelector("#urlPreviewFrame"),
  screenModeBtn: document.querySelector("#screenModeBtn"),
  allTextModeBtn: document.querySelector("#allTextModeBtn"),
  refreshTextBtn: document.querySelector("#refreshTextBtn"),
  sendEnterBtn: document.querySelector("#sendEnterBtn"),
  sendEscBtn: document.querySelector("#sendEscBtn"),
  sendCtrlCBtn: document.querySelector("#sendCtrlCBtn"),
  sendCtrlDBtn: document.querySelector("#sendCtrlDBtn"),
  sendForm: document.querySelector("#sendForm"),
  sendTextInput: document.querySelector("#sendTextInput"),
  autoRefreshToggle: document.querySelector("#autoRefreshToggle"),
  statusTargetName: document.querySelector("#statusTargetName"),
  statusSocketName: document.querySelector("#statusSocketName"),
  statusMessage: document.querySelector("#statusMessage"),
  statusPaneName: document.querySelector("#statusPaneName"),
  statusAutoRefresh: document.querySelector("#statusAutoRefresh"),
  targetName: document.querySelector("#targetName"),
  targetSsh: document.querySelector("#targetSsh"),
  targetKittyBinary: document.querySelector("#targetKittyBinary"),
  targetSocketPattern: document.querySelector("#targetSocketPattern"),
  targetDefaultSocket: document.querySelector("#targetDefaultSocket"),
  targetNotes: document.querySelector("#targetNotes")
};

let pollTimer = null;
let resizeSession = null;
let pendingScrollLines = 0;
let scrollFlushTimer = null;
let remoteScrollInFlight = false;
let screenRequestSerial = 0;
let sessionRequestSerial = 0;
let autoRefreshTick = 0;

function getSelectedTarget() {
  return state.targets.find((target) => target.id === state.selectedTargetId) || null;
}

function getEditingTarget() {
  return state.targets.find((target) => target.id === state.editingTargetId) || null;
}

function invalidateScreenRequests() {
  screenRequestSerial += 1;
  state.refreshing = false;
}

function invalidateSessionRequests() {
  sessionRequestSerial += 1;
  invalidateScreenRequests();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSidebarWidthBounds() {
  const viewportWidth = window.innerWidth || 1200;

  if (viewportWidth <= 720) {
    const max = Math.max(160, Math.floor(viewportWidth * 0.42));
    return { min: 160, max };
  }

  if (viewportWidth <= 980) {
    const max = Math.max(SIDEBAR_WIDTH_RANGE.min, Math.floor(viewportWidth * 0.36));
    return { min: SIDEBAR_WIDTH_RANGE.min, max };
  }

  return SIDEBAR_WIDTH_RANGE;
}

function getEffectiveSidebarWidth() {
  const bounds = getSidebarWidthBounds();
  return clamp(state.sidebarWidth, bounds.min, bounds.max);
}

function getActivityBarWidth() {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--activity-width"));
  return Number.isFinite(value) ? value : 54;
}

function getBrowserWidthBounds() {
  const viewportWidth = window.innerWidth || 1200;
  const activityWidth = getActivityBarWidth();
  const sidebarWidth = viewportWidth <= 720 || !state.sidebarVisible ? 0 : getEffectiveSidebarWidth();
  const handleWidth = state.resizeEnabled && state.sidebarVisible && viewportWidth > 720 ? 6 : 0;
  const minEditorWidth = viewportWidth <= 720 ? 96 : 180;
  const maxByLayout = viewportWidth - activityWidth - sidebarWidth - handleWidth - minEditorWidth;

  if (viewportWidth <= 720) {
    const min = Math.min(260, Math.max(220, maxByLayout));
    return { min, max: Math.max(min, maxByLayout) };
  }

  const min = Math.min(BROWSER_WIDTH_RANGE.min, Math.max(260, maxByLayout));
  const max = Math.max(min, Math.min(BROWSER_WIDTH_RANGE.max, maxByLayout));
  return { min, max };
}

function getEffectiveBrowserWidth() {
  const bounds = getBrowserWidthBounds();
  return clamp(state.browserWidth, bounds.min, bounds.max);
}

function normalizeFontSizePx(value) {
  if (Number.isFinite(value)) {
    return clamp(Math.round(value), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
  }

  if (value === "small") {
    return 12;
  }

  if (value === "large") {
    return 14;
  }

  return FONT_SIZE_RANGE.default;
}

function loadUiPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    state.autoRefresh = parsed.autoRefresh !== false;
    state.uiFontSizePx = normalizeFontSizePx(parsed.uiFontSizePx ?? parsed.uiFontSize);
    state.uiTheme = THEME_SET.has(parsed.uiTheme) ? parsed.uiTheme : "dark";
    state.screenExtent = TEXT_EXTENT_SET.has(parsed.screenExtent) ? parsed.screenExtent : "screen";
    state.resizeEnabled = Boolean(parsed.resizeEnabled);
    state.activeSidebarView = ["ssh", "sessions"].includes(parsed.activeSidebarView)
      ? parsed.activeSidebarView
      : "ssh";
    state.previewVisible = Boolean(parsed.previewVisible);
    state.previewPinned = Boolean(parsed.previewPinned);
    state.previewUrl = typeof parsed.previewUrl === "string" ? parsed.previewUrl : "";
    state.previewHistory = Array.isArray(parsed.previewHistory)
      ? parsed.previewHistory.filter((url) => typeof url === "string" && url.trim()).slice(-30)
      : [];
    if (state.previewUrl && !state.previewHistory.includes(state.previewUrl)) {
      state.previewHistory.push(state.previewUrl);
    }
    state.previewHistoryIndex = state.previewHistory.length
      ? clamp(Number.isFinite(parsed.previewHistoryIndex) ? parsed.previewHistoryIndex : state.previewHistory.length - 1, 0, state.previewHistory.length - 1)
      : -1;
    if (state.previewHistoryIndex >= 0) {
      state.previewUrl = state.previewHistory[state.previewHistoryIndex];
    }
    state.sidebarVisible = parsed.sidebarVisible !== false;
    state.sidebarWidth = Number.isFinite(parsed.sidebarWidth)
      ? clamp(parsed.sidebarWidth, SIDEBAR_WIDTH_RANGE.min, SIDEBAR_WIDTH_RANGE.max)
      : 320;
    state.browserWidth = Number.isFinite(parsed.browserWidth)
      ? clamp(parsed.browserWidth, BROWSER_WIDTH_RANGE.min, BROWSER_WIDTH_RANGE.max)
      : BROWSER_WIDTH_RANGE.default;
    state.bottomPanelHeight = Number.isFinite(parsed.bottomPanelHeight)
      ? clamp(parsed.bottomPanelHeight, PANEL_HEIGHT_RANGE.min, PANEL_HEIGHT_RANGE.max)
      : 230;
  } catch (error) {
    state.autoRefresh = true;
    state.uiFontSizePx = FONT_SIZE_RANGE.default;
    state.uiTheme = "dark";
    state.screenExtent = "screen";
    state.resizeEnabled = false;
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
    state.previewVisible = false;
    state.previewPinned = false;
    state.previewHistory = [];
    state.previewHistoryIndex = -1;
    state.sidebarWidth = 320;
    state.browserWidth = BROWSER_WIDTH_RANGE.default;
    state.bottomPanelHeight = 230;
  }
}

function saveUiPreferences() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      autoRefresh: state.autoRefresh,
      uiFontSizePx: state.uiFontSizePx,
      uiTheme: state.uiTheme,
      screenExtent: state.screenExtent,
      previewVisible: state.previewVisible,
      previewPinned: state.previewPinned,
      previewUrl: state.previewUrl,
      previewHistory: state.previewHistory,
      previewHistoryIndex: state.previewHistoryIndex,
      resizeEnabled: state.resizeEnabled,
      activeSidebarView: state.activeSidebarView,
      sidebarVisible: state.sidebarVisible,
      sidebarWidth: state.sidebarWidth,
      browserWidth: state.browserWidth,
      bottomPanelHeight: state.bottomPanelHeight
    })
  );
}

function truncateLabel(value, maxLength = 84) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function renderBrowserHistoryOptions() {
  const items = state.previewHistory.map((url, index) => {
    const prefix = index === state.previewHistoryIndex ? "Current" : `${index + 1}`;
    return `<option value="${index}">${escapeHtml(`${prefix} · ${truncateLabel(url)}`)}</option>`;
  });

  elements.browserHistorySelect.innerHTML = [
    `<option value="">History</option>`,
    ...items
  ].join("");
  elements.browserHistorySelect.value = state.previewHistoryIndex >= 0
    ? String(state.previewHistoryIndex)
    : "";
  elements.browserHistorySelect.disabled = state.previewHistory.length === 0;
}

function applyUiState() {
  const showingSsh = state.activeSidebarView === "ssh";
  const showingSessions = state.activeSidebarView === "sessions";
  elements.sshSidebarView.hidden = !showingSsh;
  elements.sessionsSidebarView.hidden = !showingSessions;
  elements.appShell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
  elements.appShell.classList.toggle("preview-open", state.previewVisible);
  elements.appShell.classList.toggle("browser-pinned", state.previewVisible && state.previewPinned);
  elements.showSshViewBtn.classList.toggle("active", state.sidebarVisible && showingSsh);
  elements.showSessionsViewBtn.classList.toggle("active", state.sidebarVisible && showingSessions);
  elements.showSshViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSsh));
  elements.showSessionsViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSessions));
  elements.appShell.classList.toggle("resize-enabled", state.resizeEnabled);
  elements.previewDrawer.setAttribute("aria-hidden", String(!state.previewVisible));
  elements.reopenPreviewBtn.hidden = state.previewVisible || !state.previewUrl;
  elements.reopenPreviewBtn.setAttribute("aria-hidden", String(state.previewVisible || !state.previewUrl));
  elements.browserBackBtn.disabled = state.previewHistoryIndex <= 0;
  elements.browserForwardBtn.disabled = state.previewHistoryIndex < 0 || state.previewHistoryIndex >= state.previewHistory.length - 1;
  elements.browserGoBtn.disabled = !state.selectedTargetId;
  elements.pinBrowserBtn.classList.toggle("active", state.previewPinned);
  elements.pinBrowserBtn.setAttribute("aria-pressed", String(state.previewPinned));
  elements.pinBrowserBtn.title = state.previewPinned ? "取消固定 Browser" : "固定 Browser";
  if (document.activeElement !== elements.browserAddressInput) {
    elements.browserAddressInput.value = state.previewUrl;
  }
  renderBrowserHistoryOptions();
  elements.autoRefreshToggle.checked = state.autoRefresh;
  elements.fontSizeValue.textContent = `${state.uiFontSizePx}px`;
  elements.themeSelect.value = state.uiTheme;
  elements.screenModeBtn.classList.toggle("active", state.screenExtent === "screen");
  elements.allTextModeBtn.classList.toggle("active", state.screenExtent === "all");
  elements.screenModeBtn.setAttribute("aria-pressed", String(state.screenExtent === "screen"));
  elements.allTextModeBtn.setAttribute("aria-pressed", String(state.screenExtent === "all"));
  elements.refreshTextBtn.textContent = state.screenExtent === "all" ? "Refresh All" : "Refresh";
  elements.screenOutput.dataset.extent = state.screenExtent;
  elements.resizeToggle.checked = state.resizeEnabled;
  document.documentElement.style.setProperty("--root-font-size", `${state.uiFontSizePx}px`);
  document.documentElement.dataset.theme = state.uiTheme;
  document.documentElement.style.setProperty("--sidebar-width", `${getEffectiveSidebarWidth()}px`);
  document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
  document.documentElement.style.setProperty("--bottom-panel-height", `${state.bottomPanelHeight}px`);
  applyResizeLabel();
  updateStatusBar();
  saveUiPreferences();
}

function applyResizeLabel() {
  elements.resizeLabel.textContent = state.resizeEnabled ? "Resize Unlocked" : "Layout Locked";
}

function stepFontSize(delta) {
  state.uiFontSizePx = clamp(state.uiFontSizePx + delta, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
  applyUiState();
}

function setStatus(message, mode) {
  elements.targetStatus.textContent = message;
  elements.targetStatus.dataset.mode = mode || "neutral";
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.mode = mode || "neutral";
}

function setPreviewStatus(message, mode) {
  elements.previewAddress.textContent = message;
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.mode = mode || "neutral";
}

function createPreviewResourceUrl(url, targetId) {
  const params = new URLSearchParams({
    targetId,
    url
  });
  return `/api/url-resource?${params.toString()}`;
}

function normalizeBrowserUrl(rawUrl) {
  const value = String(rawUrl || "").trim();

  if (!value) {
    throw new Error("URL 为空。");
  }

  const schemeMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    if (/^[A-Za-z0-9.-]+:\d+(?:[/?#].*)?$/.test(value)) {
      return new URL(`https://${value}`).href;
    }

    const parsed = new URL(value);
    if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
      throw new Error("只支持 http://, https:// 和 file:// URL。");
    }
    return parsed.href;
  }

  if (value.startsWith("/")) {
    return new URL(`file://${value}`).href;
  }

  return new URL(`https://${value}`).href;
}

function rememberPreviewUrl(url, mode = "push") {
  if (mode === "none") {
    return;
  }

  if (mode === "replace" && state.previewHistoryIndex >= 0) {
    state.previewHistory[state.previewHistoryIndex] = url;
    state.previewUrl = url;
    return;
  }

  if (state.previewHistory[state.previewHistoryIndex] === url) {
    state.previewUrl = url;
    return;
  }

  const nextHistory = state.previewHistory.slice(0, state.previewHistoryIndex + 1);
  nextHistory.push(url);
  state.previewHistory = nextHistory.slice(-30);
  state.previewHistoryIndex = state.previewHistory.length - 1;
  state.previewUrl = url;
}

function replaceLoadedPreviewUrl(url) {
  if (!url || url === state.previewUrl) {
    return;
  }

  if (state.previewHistoryIndex >= 0) {
    state.previewHistory[state.previewHistoryIndex] = url;
  } else {
    state.previewHistory = [url];
    state.previewHistoryIndex = 0;
  }

  state.previewUrl = url;
}

function syncPreviewFrame() {
  const target = getSelectedTarget();
  if (!target || !state.previewUrl) {
    return false;
  }

  const nextSrc = createPreviewResourceUrl(state.previewUrl, state.selectedTargetId);
  elements.previewTitle.textContent = target.name ? `${target.name} Browser` : "Browser";
  elements.previewAddress.textContent = state.previewUrl;
  if (elements.urlPreviewFrame.getAttribute("src") !== nextSrc) {
    elements.urlPreviewFrame.src = nextSrc;
  }
  return true;
}

function setTargetHealth(label, mode) {
  elements.targetHealth.textContent = label;
  elements.targetHealth.dataset.mode = mode || "neutral";
  updateStatusBar();
}

function setAuthStatus(message, mode) {
  elements.authStatusText.textContent = message;
  if (mode) {
    elements.authStatusText.dataset.mode = mode;
  } else {
    delete elements.authStatusText.dataset.mode;
  }
}

function setAuthState(authenticated, device = null) {
  state.authenticated = Boolean(authenticated);
  state.authDevice = state.authenticated ? device : null;
  elements.authGate.hidden = state.authenticated;
  elements.authDeviceLabel.hidden = !state.authenticated;
  elements.logoutBtn.hidden = !state.authenticated;
  elements.authDeviceLabel.textContent = state.authDevice ? `Device: ${state.authDevice.label}` : "";

  if (!state.authenticated && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function updateStatusBar() {
  const target = getSelectedTarget();
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));
  elements.statusTargetName.textContent = `Target: ${target ? target.name : "-"}`;
  elements.statusSocketName.textContent = `Socket: ${state.selectedSocket || "auto"}`;
  elements.statusPaneName.textContent = pane
    ? `Pane: Window ${pane.osWindowId} / Tab ${pane.tabId} / #${pane.id}`
    : "Pane: -";
  elements.statusAutoRefresh.textContent = `Auto-refresh: ${state.autoRefresh ? "on" : "off"}`;
}

function isScreenOutputNearBottom(threshold = 48) {
  const output = elements.screenOutput;
  return output.scrollHeight - output.scrollTop - output.clientHeight < threshold;
}

function setScreenOutputScrollTop(scrollTop) {
  const output = elements.screenOutput;
  const maxScrollTop = Math.max(0, output.scrollHeight - output.clientHeight);
  output.scrollTop = clamp(scrollTop, 0, maxScrollTop);
}

function renderScreenText(text, options = {}) {
  const output = elements.screenOutput;
  const previousTop = output.scrollTop;
  const wasNearBottom = isScreenOutputNearBottom();
  const nextText = text || "";

  if (state.screenText !== nextText) {
    state.screenText = nextText;
    output.innerHTML = linkifyTerminalText(state.screenText || "(当前屏幕为空)");
  }

  if (state.screenExtent === "all") {
    if (options.scrollToBottom || state.allTextFollowTail || wasNearBottom) {
      output.scrollTop = output.scrollHeight;
      state.allTextFollowTail = true;
    } else {
      output.scrollTop = previousTop;
    }
    return;
  }

  if (options.scrollToTop) {
    output.scrollTop = 0;
  } else if (options.scrollToBottom) {
    output.scrollTop = output.scrollHeight;
  } else {
    setScreenOutputScrollTop(previousTop);
  }
}

function handleScreenOutputScroll() {
  if (state.screenExtent !== "all") {
    return;
  }

  const wasFollowing = state.allTextFollowTail;
  state.allTextFollowTail = isScreenOutputNearBottom();

  if (wasFollowing && !state.allTextFollowTail) {
    setStatus("Browsing history · All auto refresh paused.", "neutral");
  } else if (!wasFollowing && state.allTextFollowTail) {
    setStatus("All mode tailing latest output.", "neutral");
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    setAuthState(false);
    setAuthStatus("登录已失效，请重新输入这台设备的 token。", "danger");
    throw new Error(payload.error || "Authentication required.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "请求失败。");
  }
  return payload;
}

async function checkAuthStatus() {
  const payload = await apiFetch("/api/auth/status");
  setAuthState(Boolean(payload.authenticated), payload.device || null);
  return state.authenticated;
}

async function loginWithDeviceToken() {
  const token = elements.authTokenInput.value.trim();

  if (!token) {
    setAuthStatus("请输入 device token。", "danger");
    return;
  }

  const payload = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });

  elements.authTokenInput.value = "";
  setAuthState(true, payload.device);
  setAuthStatus("登录成功。", "success");
  await bootAuthenticatedWorkspace();
}

async function logoutDevice() {
  await apiFetch("/api/auth/logout", {
    method: "POST"
  });
  setAuthState(false);
  state.targets = [];
  clearSessionSelection();
  renderTargetSelect();
  renderSavedTargets();
  setAuthStatus("已退出。", "neutral");
}

function normalizeTransport(value) {
  return value === "ssh" ? "ssh" : "local";
}

function getTargetConnectionLabel(target) {
  const transport = normalizeTransport(target?.transport);
  if (transport === "ssh") {
    return target?.sshTarget || "SSH";
  }
  return "Local";
}

function syncTargetTransportFormState() {
  const transport = normalizeTransport(elements.targetTransport.value);
  const isSsh = transport === "ssh";
  const sshField = elements.targetSsh.closest("label");
  elements.targetSsh.disabled = !isSsh;
  elements.targetSsh.required = isSsh;
  elements.targetSsh.placeholder = isSsh ? "ssh-host" : "Local 不需要 SSH 目标";
  if (sshField) {
    sshField.hidden = !isSsh;
  }
}

function readTargetForm() {
  const transport = normalizeTransport(elements.targetTransport.value);
  return {
    id: state.editingTargetId || undefined,
    name: elements.targetName.value.trim(),
    transport,
    sshTarget: elements.targetSsh.value.trim(),
    kittyBinary: elements.targetKittyBinary.value.trim(),
    socketPattern: elements.targetSocketPattern.value.trim(),
    defaultSocket: elements.targetDefaultSocket.value.trim(),
    notes: elements.targetNotes.value.trim()
  };
}

function writeTargetForm(target) {
  const source = {
    ...DEFAULT_TARGET_FORM,
    ...(target || {})
  };
  elements.targetName.value = source.name || "";
  elements.targetTransport.value = normalizeTransport(source.transport);
  elements.targetSsh.value = source.sshTarget || "";
  elements.targetKittyBinary.value = source.kittyBinary || DEFAULT_TARGET_FORM.kittyBinary;
  elements.targetSocketPattern.value = source.socketPattern || DEFAULT_TARGET_FORM.socketPattern;
  elements.targetDefaultSocket.value = source.defaultSocket || "";
  elements.targetNotes.value = source.notes || "";
  syncTargetTransportFormState();
}

function renderTargetSelect() {
  if (!state.targets.length) {
    elements.targetSelect.innerHTML = `<option value="">没有保存的目标</option>`;
    elements.targetSelect.disabled = true;
    return;
  }

  elements.targetSelect.disabled = false;
  elements.targetSelect.innerHTML = state.targets
    .map((target) => {
      const selected = target.id === state.selectedTargetId ? "selected" : "";
      const connectionLabel = getTargetConnectionLabel(target);
      return `
        <option value="${escapeAttribute(target.id)}" ${selected}>
          ${escapeHtml(target.name)} · ${escapeHtml(connectionLabel)}
        </option>
      `;
    })
    .join("");

  elements.targetSelect.value = state.selectedTargetId;
  updateStatusBar();
}

function renderSavedTargets() {
  if (!state.targets.length) {
    elements.savedTargets.innerHTML = `<p class="empty-note">还没有保存的目标。</p>`;
    return;
  }

  elements.savedTargets.innerHTML = state.targets
    .map((target) => {
      const active = target.id === state.editingTargetId ? "active" : "";
      const selected = target.id === state.selectedTargetId ? "selected" : "";
      const connectionLabel = getTargetConnectionLabel(target);
      return `
        <button class="target-chip ${active} ${selected}" type="button" data-target-id="${target.id}">
          <span>${escapeHtml(target.name)}</span>
          <small>${escapeHtml(connectionLabel)}</small>
        </button>
      `;
    })
    .join("");

  elements.savedTargets.querySelectorAll("[data-target-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.targetId;
      state.selectedTargetId = targetId;
      state.editingTargetId = targetId;
      clearSessionSelection();
      const target = getSelectedTarget();
      writeTargetForm(target);
      renderSavedTargets();
      renderTargetSelect();
      setTargetHealth("待连接", "neutral");
      await apiFetch("/api/targets/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId })
      });
      setStatus(`已切换到 ${target.name}，顶部下拉菜单也已同步。`, "neutral");
    });
  });
}

function flattenWindows(tree) {
  const flat = [];

  tree.forEach((osWindow) => {
    (osWindow.tabs || []).forEach((tab) => {
      (tab.windows || []).forEach((window) => {
        flat.push({
          ...window,
          osWindowId: osWindow.id,
          tabId: tab.id,
          tabTitle: tab.title,
          tabLayout: tab.layout,
          osWindowFocused: osWindow.is_focused
        });
      });
    });
  });

  return flat;
}

function getWindowProcessLabel(windowInfo) {
  const rawLabel = (windowInfo.foreground_processes || [])
    .map((item) => (item.cmdline || []).join(" "))
    .filter(Boolean)[0] || (windowInfo.cmdline || []).join(" ");
  const firstCommand = rawLabel.split("|")[0].trim();
  const commandPath = firstCommand.split(/\s+/)[0] || "";
  const basename = commandPath.split(/[\\/]/).filter(Boolean).pop();

  return basename || "process";
}

function renderSessions() {
  const totalWindows = state.flatWindows.length;
  const selectedTarget = getSelectedTarget();

  elements.sessionSummary.textContent = selectedTarget
    ? `${selectedTarget.name} · ${state.sessionTree.length} 个 OS 窗口 / ${totalWindows} 个 panes`
    : "先从顶部选择一个目标，然后连接。";

  if (!state.sessionTree.length) {
    elements.sessionTree.innerHTML = `<div class="empty-note">还没有 kitty 会话数据。点击顶部的“连接”开始加载。</div>`;
    return;
  }

  const markup = state.sessionTree
    .map((osWindow) => {
      const tabs = (osWindow.tabs || [])
        .map((tab) => {
          const windows = (tab.windows || [])
            .map((window) => {
              const activeClass = Number(window.id) === Number(state.selectedWindowId) ? "selected" : "";
              const badges = [];
              if (window.is_active) badges.push("active");
              if (window.is_focused) badges.push("focused");
              if (window.at_prompt) badges.push("prompt");

              return `
                <button class="pane-item ${activeClass}" type="button" data-window-id="${window.id}">
                  <div class="pane-item-head">
                    <strong>${escapeHtml(window.title || `Pane ${window.id}`)}</strong>
                    <span>#${window.id}</span>
                  </div>
                  <p>${escapeHtml(window.cwd || "")}</p>
                  <small>${escapeHtml(getWindowProcessLabel(window))}</small>
                  <div class="badge-row">
                    ${badges.map((badge) => `<span class="mini-badge">${badge}</span>`).join("")}
                  </div>
                </button>
              `;
            })
            .join("");

          return `
            <article class="tab-block">
              <div class="tab-head">
                <div>
                  <h4>${escapeHtml(tab.title || `Tab ${tab.id}`)}</h4>
                  <small>${escapeHtml(tab.layout || "")}</small>
                </div>
                <span>tab #${tab.id}</span>
              </div>
              <div class="pane-grid">${windows}</div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="os-window-block">
          <div class="os-window-head">
            <div>
              <h3>OS Window #${osWindow.id}</h3>
              <small>${osWindow.is_focused ? "当前聚焦" : "后台窗口"}</small>
            </div>
            <span>${(osWindow.tabs || []).length} tabs</span>
          </div>
          ${tabs}
        </section>
      `;
    })
    .join("");

  elements.sessionTree.innerHTML = markup;

  elements.sessionTree.querySelectorAll("[data-window-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedWindowId = Number(button.dataset.windowId);
      invalidateScreenRequests();
      renderSessions();
      renderViewerMeta();
      await refreshScreen({
        force: true,
        scrollToBottom: state.screenExtent === "all" && state.allTextFollowTail,
        scrollToTop: state.screenExtent === "screen"
      });
    });
  });
}

function renderSocketOptions(sockets, selectedSocket) {
  const safeSockets = sockets?.length ? sockets : [""];
  elements.socketSelect.innerHTML = safeSockets
    .map((socket) => {
      const label = socket || "自动选择最新 socket";
      const selected = socket === selectedSocket ? "selected" : "";
      return `<option value="${escapeAttribute(socket)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  elements.socketSelect.value = selectedSocket || "";
  updateStatusBar();
}

function renderViewerMeta() {
  const windowInfo = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));

  if (!windowInfo) {
    elements.viewerMeta.textContent = "选中一个 pane 后，这里会显示它的标题和目录。";
    return;
  }

  elements.viewerMeta.innerHTML = `
    <strong>${escapeHtml(windowInfo.title || `Pane ${windowInfo.id}`)}</strong>
    <span>pane #${windowInfo.id}</span>
    <span>${escapeHtml(windowInfo.cwd || "")}</span>
  `;
}

function closePreview() {
  state.previewVisible = false;
  applyUiState();
}

function toggleBrowserPin() {
  state.previewPinned = !state.previewPinned;
  if (state.previewPinned && state.previewUrl) {
    state.previewVisible = true;
  }
  applyUiState();
}

function reopenPreview() {
  if (!state.previewUrl) {
    setPreviewStatus("还没有 Browser URL。", "neutral");
    return;
  }

  state.previewVisible = true;
  syncPreviewFrame();
  applyUiState();
}

function goBackPreview() {
  if (state.previewHistoryIndex <= 0) {
    return;
  }

  state.previewHistoryIndex -= 1;
  state.previewUrl = state.previewHistory[state.previewHistoryIndex] || "";
  state.previewVisible = true;
  syncPreviewFrame();
  applyUiState();
}

function goForwardPreview() {
  if (state.previewHistoryIndex < 0 || state.previewHistoryIndex >= state.previewHistory.length - 1) {
    return;
  }

  state.previewHistoryIndex += 1;
  state.previewUrl = state.previewHistory[state.previewHistoryIndex] || "";
  state.previewVisible = true;
  syncPreviewFrame();
  applyUiState();
}

function jumpPreviewHistory(index) {
  const nextIndex = Number(index);
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= state.previewHistory.length) {
    return;
  }

  state.previewHistoryIndex = nextIndex;
  state.previewUrl = state.previewHistory[nextIndex] || "";
  state.previewVisible = true;
  syncPreviewFrame();
  applyUiState();
}

async function loadUrlPreview(rawUrl, options = {}) {
  const target = getSelectedTarget();

  if (!target) {
    setPreviewStatus("先选择一个连接目标。", "warning");
    return;
  }

  const url = normalizeBrowserUrl(rawUrl);

  rememberPreviewUrl(url, options.history || "push");
  state.previewVisible = true;
  syncPreviewFrame();
  applyUiState();
  setPreviewStatus(`正在通过 ${target.name} 打开 ${url}`, "neutral");
}

function maybeCloseUnpinnedBrowser(event) {
  if (!state.previewVisible || state.previewPinned) {
    return;
  }

  const path = event.composedPath ? event.composedPath() : [];
  if (
    path.includes(elements.previewDrawer) ||
    path.includes(elements.reopenPreviewBtn)
  ) {
    return;
  }

  state.previewVisible = false;
  applyUiState();
}

function handleBrowserMessage(event) {
  if (event.source !== elements.urlPreviewFrame.contentWindow) {
    return;
  }

  const message = event.data || {};
  if (message.source !== "kitty-remote-deck-browser") {
    return;
  }

  if (message.targetId && message.targetId !== state.selectedTargetId) {
    return;
  }

  if (message.type === "browser:navigate") {
    loadUrlPreview(message.url).catch((error) => setPreviewStatus(error.message, "danger"));
    return;
  }

  if (message.type === "browser:loaded") {
    try {
      const url = normalizeBrowserUrl(message.url);
      replaceLoadedPreviewUrl(url);
      setPreviewStatus(`已加载 ${url}`, "neutral");
      applyUiState();
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
  }
}

function clearSessionSelection() {
  invalidateSessionRequests();
  state.selectedSocket = "";
  state.sessionTree = [];
  state.flatWindows = [];
  state.selectedWindowId = null;
  state.screenText = "";
  state.allTextFollowTail = true;
  renderSocketOptions([], "");
  renderSessions();
  renderViewerMeta();
  elements.screenOutput.textContent = "等待选择一个 kitty pane…";
  updateStatusBar();
}

async function loadTargets() {
  const previousSelected = state.selectedTargetId;
  const previousEditing = state.editingTargetId;
  const data = await apiFetch("/api/targets");

  state.targets = data.targets || [];
  state.selectedTargetId = state.targets.some((target) => target.id === previousSelected)
    ? previousSelected
    : data.lastSelectedTargetId || state.targets[0]?.id || "";
  state.editingTargetId = state.targets.some((target) => target.id === previousEditing)
    ? previousEditing
    : state.selectedTargetId;

  renderTargetSelect();
  renderSavedTargets();
  writeTargetForm(getEditingTarget() || getSelectedTarget());
  updateStatusBar();
}

async function saveTarget() {
  const payload = readTargetForm();
  const data = await apiFetch("/api/targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: payload })
  });

  state.selectedTargetId = data.target.id;
  state.editingTargetId = data.target.id;
  await loadTargets();
  renderTargetSelect();
  setStatus(`目标 ${data.target.name} 已保存。之后可以直接从顶栏切换。`, "success");
}

async function testTargetRequest(requestBody) {
  const result = await apiFetch("/api/targets/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  setTargetHealth("连接正常", "success");
  renderSocketOptions(result.sockets || [], result.selectedSocket || "");
  state.selectedSocket = result.selectedSocket || "";
  setStatus(
    `${result.host} / ${result.user}：发现 ${result.sockets.length} 个 socket，${result.windowCount} 个 panes。`,
    "success"
  );

  return result;
}

async function testDraftTarget() {
  return testTargetRequest({
    target: readTargetForm(),
    socket: state.selectedSocket || ""
  });
}

async function connectSelectedTarget() {
  if (!state.selectedTargetId) {
    setStatus("先保存一个连接目标。", "warning");
    return;
  }

  await testTargetRequest({
    targetId: state.selectedTargetId,
    socket: state.selectedSocket || ""
  });
  await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
}

async function loadSessions(options = {}) {
  if (!state.selectedTargetId) {
    setStatus("先从顶部选择一个连接目标。", "warning");
    return;
  }

  const requestSerial = ++sessionRequestSerial;
  const capturedTargetId = state.selectedTargetId;
  const capturedSocket = state.selectedSocket;
  const query = new URLSearchParams({
    targetId: capturedTargetId
  });

  if (capturedSocket) {
    query.set("socket", capturedSocket);
  }

  const data = await apiFetch(`/api/sessions?${query.toString()}`);
  if (
    requestSerial !== sessionRequestSerial ||
    capturedTargetId !== state.selectedTargetId ||
    capturedSocket !== state.selectedSocket
  ) {
    return;
  }

  const previousWindowId = state.selectedWindowId;
  state.sessionTree = data.tree || [];
  state.flatWindows = flattenWindows(state.sessionTree);
  state.selectedSocket = data.selectedSocket || "";
  renderSocketOptions(data.sockets || [], state.selectedSocket);

  if (!state.selectedWindowId && state.flatWindows[0]) {
    state.selectedWindowId = Number(state.flatWindows[0].id);
  } else if (
    state.selectedWindowId &&
    !state.flatWindows.some((window) => Number(window.id) === Number(state.selectedWindowId))
  ) {
    state.selectedWindowId = state.flatWindows[0] ? Number(state.flatWindows[0].id) : null;
  }

  const selectedWindowChanged = Number(previousWindowId) !== Number(state.selectedWindowId);
  if (selectedWindowChanged) {
    invalidateScreenRequests();
  }

  renderSessions();
  renderViewerMeta();
  setTargetHealth("已连接", "success");
  updateStatusBar();

  if (state.selectedWindowId) {
    if (options.refreshPane !== false) {
      await refreshScreen({
        force: Boolean(options.forceRefresh),
        scrollToBottom: Boolean(options.scrollToBottom)
      });
    } else if (selectedWindowChanged) {
      state.screenText = "";
      elements.screenOutput.textContent = "当前 pane 已变化，点击 Refresh 更新内容。";
    }
  } else {
    elements.screenOutput.textContent = "当前没有可显示的 pane。";
  }
}

async function refreshScreen(options = {}) {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    return;
  }

  if (state.refreshing && !options.force) {
    return;
  }

  if (state.screenExtent === "all" && !state.allTextFollowTail && !options.force) {
    setStatus("Browsing history · All auto refresh paused.", "neutral");
    return;
  }

  const requestSerial = ++screenRequestSerial;
  const capturedTargetId = state.selectedTargetId;
  const capturedSocket = state.selectedSocket;
  const capturedWindowId = state.selectedWindowId;
  const capturedExtent = state.screenExtent;
  state.refreshing = true;

  try {
    const query = new URLSearchParams({
      targetId: capturedTargetId,
      windowId: String(capturedWindowId),
      extent: capturedExtent
    });

    if (capturedSocket) {
      query.set("socket", capturedSocket);
    }

    const data = await apiFetch(`/api/screen?${query.toString()}`);
    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId) &&
      capturedExtent === state.screenExtent
    ) {
      renderScreenText(data.text || "", options);
    }
  } finally {
    if (requestSerial === screenRequestSerial) {
      state.refreshing = false;
    }
  }
}

function wheelDeltaToLines(event) {
  if (event.deltaMode === 1) {
    return event.deltaY;
  }

  if (event.deltaMode === 2) {
    return event.deltaY * 24;
  }

  return event.deltaY / 42;
}

function queueRemoteScrollFromWheel(event) {
  if (state.screenExtent !== "screen") {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("先选中一个 pane。", "warning");
    return;
  }

  pendingScrollLines += wheelDeltaToLines(event);

  if (scrollFlushTimer) {
    clearTimeout(scrollFlushTimer);
  }

  scrollFlushTimer = setTimeout(flushRemoteScroll, WHEEL_SCROLL_DEBOUNCE_MS);
}

async function flushRemoteScroll() {
  scrollFlushTimer = null;

  if (remoteScrollInFlight) {
    return;
  }

  const lines = clamp(Math.round(pendingScrollLines), -WHEEL_SCROLL_MAX_LINES, WHEEL_SCROLL_MAX_LINES);
  if (!lines) {
    return;
  }

  pendingScrollLines -= lines;
  remoteScrollInFlight = true;

  try {
    await scrollRemoteWindow(lines);
  } catch (error) {
    setStatus(error.message, "danger");
  } finally {
    remoteScrollInFlight = false;
    if (Math.abs(pendingScrollLines) >= 1) {
      scrollFlushTimer = setTimeout(flushRemoteScroll, WHEEL_SCROLL_DEBOUNCE_MS);
    }
  }
}

async function scrollRemoteWindow(lines) {
  const requestSerial = ++screenRequestSerial;
  const capturedTargetId = state.selectedTargetId;
  const capturedSocket = state.selectedSocket;
  const capturedWindowId = state.selectedWindowId;
  state.refreshing = true;

  try {
    const data = await apiFetch("/api/scroll-window", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: capturedTargetId,
        socket: capturedSocket,
        windowId: capturedWindowId,
        lines
      })
    });

    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId) &&
      state.screenExtent === "screen"
    ) {
      renderScreenText(data.text || "");
      setStatus(`已滚动 pane #${state.selectedWindowId} ${Math.abs(lines)} 行。`, "success");
    }
  } finally {
    if (requestSerial === screenRequestSerial) {
      state.refreshing = false;
    }
  }
}

async function sendText() {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("先选中一个 pane。", "warning");
    return false;
  }

  const text = elements.sendTextInput.value;
  if (!text.trim()) {
    setStatus("输入点内容再发。", "warning");
    return false;
  }

  await apiFetch("/api/send-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: state.selectedTargetId,
      socket: state.selectedSocket,
      windowId: state.selectedWindowId,
      text
    })
  });

  setStatus(`已向 pane #${state.selectedWindowId} 发送文本。`, "success");
  elements.sendTextInput.value = "";
  await refreshScreen({ scrollToBottom: true });
  return true;
}

async function sendKey(key) {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("先选中一个 pane。", "warning");
    return;
  }

  await apiFetch("/api/send-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: state.selectedTargetId,
      socket: state.selectedSocket,
      windowId: state.selectedWindowId,
      key
    })
  });

  setStatus(`已发送按键 ${key} 到 pane #${state.selectedWindowId}。`, "success");
  await refreshScreen({ scrollToBottom: true });
}

async function focusWindow() {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("先选中一个 pane。", "warning");
    return;
  }

  await apiFetch("/api/focus-window", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: state.selectedTargetId,
      socket: state.selectedSocket,
      windowId: state.selectedWindowId
    })
  });

  setStatus(`已请求聚焦 pane #${state.selectedWindowId}。`, "success");
}

async function sendComposerShortcut() {
  const text = elements.sendTextInput.value;

  if (text.trim()) {
    await sendText();
    return;
  }

  await sendKey("enter");
}

async function setScreenExtent(extent) {
  const nextExtent = extent === "all" ? "all" : "screen";
  if (state.screenExtent === nextExtent) {
    return;
  }

  state.screenExtent = nextExtent;
  state.allTextFollowTail = true;
  invalidateScreenRequests();
  pendingScrollLines = 0;
  if (scrollFlushTimer) {
    clearTimeout(scrollFlushTimer);
    scrollFlushTimer = null;
  }

  applyUiState();
  await refreshScreen({ force: true, scrollToBottom: nextExtent === "all", scrollToTop: nextExtent === "screen" });
  setStatus(
    nextExtent === "all"
      ? "已切换到 All：显示 screen + scrollback，滚轮在网页内滚动。"
      : "已切换到 Screen：滚轮控制 kitty viewport。",
    "neutral"
  );
}

function resetTargetDraft() {
  state.editingTargetId = "";
  writeTargetForm(DEFAULT_TARGET_FORM);
  setTargetHealth("待连接", "neutral");
  setStatus("正在新建目标。保存后会出现在顶栏下拉菜单里。", "neutral");
}

function restartPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  if (!state.autoRefresh) {
    return;
  }

  autoRefreshTick = 0;
  pollTimer = setInterval(async () => {
    if (!state.selectedTargetId) {
      return;
    }

    try {
      await runAutoRefreshTick();
    } catch (error) {
      setStatus(error.message, "danger");
      setTargetHealth("连接异常", "danger");
    }
  }, AUTO_REFRESH_MS);
}

async function runAutoRefreshTick() {
  autoRefreshTick += 1;
  const refreshTree = autoRefreshTick % SESSION_TREE_REFRESH_EVERY_TICKS === 0 || !state.flatWindows.length;

  if (!state.selectedWindowId) {
    await loadSessions({ forceRefresh: true });
    return;
  }

  if (state.screenExtent === "all") {
    if (!state.allTextFollowTail) {
      if (refreshTree) {
        await loadSessions({ refreshPane: false });
      }
      setStatus("Browsing history · All auto refresh paused.", "neutral");
      return;
    }

    if (autoRefreshTick % ALL_TEXT_AUTO_REFRESH_EVERY_TICKS !== 0) {
      if (refreshTree) {
        await loadSessions({ refreshPane: false });
      }
      return;
    }
  }

  if (refreshTree) {
    await loadSessions({ forceRefresh: true });
  } else {
    await refreshScreen({ force: true });
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(text) {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

function trimUrlPunctuation(url) {
  let clean = url;
  let trailing = "";

  while (/[.,;!?)]$/.test(clean)) {
    trailing = clean.slice(-1) + trailing;
    clean = clean.slice(0, -1);
  }

  return { clean, trailing };
}

function linkifyTerminalText(text) {
  const pattern = /\b(?:https?:\/\/|file:\/\/)[^\s<>"']+/gi;
  let cursor = 0;
  let html = "";

  for (const match of String(text).matchAll(pattern)) {
    const rawUrl = match[0];
    const start = match.index || 0;
    const { clean, trailing } = trimUrlPunctuation(rawUrl);

    html += escapeHtml(String(text).slice(cursor, start));
    html += `<a class="terminal-link" href="${escapeAttribute(clean)}" data-preview-url="${escapeAttribute(clean)}">${escapeHtml(clean)}</a>`;
    html += escapeHtml(trailing);
    cursor = start + rawUrl.length;
  }

  html += escapeHtml(String(text).slice(cursor));
  return html;
}

function attachWheelContainment() {
  document.querySelectorAll(".scroll-panel").forEach((panel) => {
    panel.addEventListener(
      "wheel",
      (event) => {
        const maxScroll = panel.scrollHeight - panel.clientHeight;
        if (maxScroll <= 0) {
          return;
        }

        const nextScroll = panel.scrollTop + event.deltaY;
        if (nextScroll > 0 && nextScroll < maxScroll) {
          event.stopPropagation();
        }
      },
      { passive: true }
    );
  });
}

function setSidebarView(view) {
  const nextView = view === "ssh" ? "ssh" : "sessions";
  if (state.sidebarVisible && state.activeSidebarView === nextView) {
    state.sidebarVisible = false;
  } else {
    state.activeSidebarView = nextView;
    state.sidebarVisible = true;
  }
  applyUiState();
}

function startResize(kind, event) {
  if (!state.resizeEnabled) {
    return;
  }

  event.preventDefault();
  resizeSession = {
    kind,
    startX: event.clientX,
    startY: event.clientY,
    sidebarWidth: state.sidebarWidth,
    browserWidth: getEffectiveBrowserWidth(),
    bottomPanelHeight: state.bottomPanelHeight
  };
  elements.appShell.classList.add("resizing");
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", stopResize, { once: true });
}

function handleResizeMove(event) {
  if (!resizeSession) {
    return;
  }

  if (resizeSession.kind === "sidebar") {
    const bounds = getSidebarWidthBounds();
    state.sidebarWidth = clamp(
      resizeSession.sidebarWidth + event.clientX - resizeSession.startX,
      bounds.min,
      bounds.max
    );
  }

  if (resizeSession.kind === "panel") {
    state.bottomPanelHeight = clamp(
      resizeSession.bottomPanelHeight + resizeSession.startY - event.clientY,
      PANEL_HEIGHT_RANGE.min,
      PANEL_HEIGHT_RANGE.max
    );
  }

  if (resizeSession.kind === "browser") {
    const bounds = getBrowserWidthBounds();
    state.browserWidth = clamp(
      resizeSession.browserWidth + resizeSession.startX - event.clientX,
      bounds.min,
      bounds.max
    );
  }

  document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
  document.documentElement.style.setProperty("--bottom-panel-height", `${state.bottomPanelHeight}px`);
}

function stopResize() {
  if (!resizeSession) {
    return;
  }

  resizeSession = null;
  elements.appShell.classList.remove("resizing");
  window.removeEventListener("pointermove", handleResizeMove);
  saveUiPreferences();
}

function attachEvents() {
  elements.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      setAuthStatus("正在登录…", "neutral");
      await loginWithDeviceToken();
    } catch (error) {
      setAuthStatus(error.message, "danger");
    }
  });

  elements.logoutBtn.addEventListener("click", async () => {
    try {
      await logoutDevice();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.targetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveTarget();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.targetTransport.addEventListener("change", syncTargetTransportFormState);

  elements.reloadTargetsBtn.addEventListener("click", async () => {
    try {
      await loadTargets();
      setStatus("目标列表已刷新。", "neutral");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.newTargetBtn.addEventListener("click", () => {
    resetTargetDraft();
  });

  elements.showSshViewBtn.addEventListener("click", () => {
    setSidebarView("ssh");
  });

  elements.showSessionsViewBtn.addEventListener("click", () => {
    setSidebarView("sessions");
  });

  elements.decreaseFontBtn.addEventListener("click", () => {
    stepFontSize(-1);
  });

  elements.increaseFontBtn.addEventListener("click", () => {
    stepFontSize(1);
  });

  elements.themeSelect.addEventListener("change", () => {
    const nextTheme = elements.themeSelect.value;
    state.uiTheme = THEME_SET.has(nextTheme) ? nextTheme : "dark";
    applyUiState();
  });

  elements.resizeToggle.addEventListener("change", () => {
    state.resizeEnabled = elements.resizeToggle.checked;
    applyUiState();
  });

  elements.refreshTextBtn.addEventListener("click", async () => {
    try {
      if (state.screenExtent === "all") {
        state.allTextFollowTail = true;
      }
      await refreshScreen({ force: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.screenModeBtn.addEventListener("click", async () => {
    try {
      await setScreenExtent("screen");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.allTextModeBtn.addEventListener("click", async () => {
    try {
      await setScreenExtent("all");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.testTargetBtn.addEventListener("click", async () => {
    try {
      await testDraftTarget();
    } catch (error) {
      setTargetHealth("测试失败", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.connectTargetBtn.addEventListener("click", async () => {
    try {
      await connectSelectedTarget();
    } catch (error) {
      setTargetHealth("连接失败", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.reloadSessionsBtn.addEventListener("click", async () => {
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setTargetHealth("刷新失败", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.reloadSessionTreeBtn.addEventListener("click", async () => {
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setTargetHealth("刷新失败", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.targetSelect.addEventListener("change", async () => {
    state.selectedTargetId = elements.targetSelect.value;
    state.editingTargetId = state.selectedTargetId;
    clearSessionSelection();
    const target = getSelectedTarget();

    writeTargetForm(target);
    renderSavedTargets();
    setTargetHealth("切换中", "neutral");

    try {
      await apiFetch("/api/targets/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: state.selectedTargetId })
      });
      setStatus(`已切换到 ${target.name}。`, "neutral");
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setTargetHealth("切换失败", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.socketSelect.addEventListener("change", async () => {
    invalidateSessionRequests();
    state.selectedSocket = elements.socketSelect.value;
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setTargetHealth("切换失败", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.sidebarResizeHandle.addEventListener("pointerdown", (event) => startResize("sidebar", event));
  elements.panelResizeHandle.addEventListener("pointerdown", (event) => startResize("panel", event));
  elements.browserResizeHandle.addEventListener("pointerdown", (event) => startResize("browser", event));

  elements.screenOutput.addEventListener("wheel", queueRemoteScrollFromWheel, { passive: false });
  elements.screenOutput.addEventListener("scroll", handleScreenOutputScroll, { passive: true });
  elements.screenOutput.addEventListener("click", async (event) => {
    const link = event.target.closest?.("[data-preview-url]");
    if (!link) {
      return;
    }

    event.preventDefault();

    try {
      await loadUrlPreview(link.dataset.previewUrl);
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
  });

  elements.closePreviewBtn.addEventListener("click", closePreview);
  elements.reopenPreviewBtn.addEventListener("click", reopenPreview);
  elements.pinBrowserBtn.addEventListener("click", toggleBrowserPin);
  elements.browserBackBtn.addEventListener("click", goBackPreview);
  elements.browserForwardBtn.addEventListener("click", goForwardPreview);
  elements.browserHistorySelect.addEventListener("change", () => {
    jumpPreviewHistory(elements.browserHistorySelect.value);
  });
  elements.browserAddressForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await loadUrlPreview(elements.browserAddressInput.value);
      elements.browserAddressInput.blur();
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
  });

  elements.urlPreviewFrame.addEventListener("load", () => {
    if (state.previewVisible && state.previewUrl) {
      elements.previewAddress.textContent = `已加载 ${state.previewUrl}`;
    }
  });

  document.addEventListener("pointerdown", maybeCloseUnpinnedBrowser, true);
  document.addEventListener("focusin", maybeCloseUnpinnedBrowser, true);
  window.addEventListener("message", handleBrowserMessage);

  elements.sendEnterBtn.addEventListener("click", async () => {
    try {
      await sendKey("enter");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendEscBtn.addEventListener("click", async () => {
    try {
      await sendKey("escape");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendCtrlCBtn.addEventListener("click", async () => {
    try {
      await sendKey("ctrl+c");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendCtrlDBtn.addEventListener("click", async () => {
    try {
      await sendKey("ctrl+d");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await sendText();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendTextInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();

    try {
      await sendComposerShortcut();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.autoRefreshToggle.addEventListener("change", () => {
    state.autoRefresh = elements.autoRefreshToggle.checked;
    applyUiState();
    restartPolling();
  });

  window.addEventListener("resize", () => {
    document.documentElement.style.setProperty("--sidebar-width", `${getEffectiveSidebarWidth()}px`);
    document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
  });
}

async function bootAuthenticatedWorkspace() {
  await loadTargets();
  if (state.previewVisible && state.previewUrl) {
    syncPreviewFrame();
  }
  renderSocketOptions([], "");
  renderSessions();
  renderViewerMeta();
  setTargetHealth("待连接", "neutral");
  restartPolling();
}

async function init() {
  loadUiPreferences();
  applyUiState();
  attachEvents();
  attachWheelContainment();

  const authenticated = await checkAuthStatus();
  if (authenticated) {
    await bootAuthenticatedWorkspace();
  } else {
    setAuthStatus("请输入这台设备对应的 token。", "neutral");
    elements.authTokenInput.focus();
  }
}

init().catch((error) => {
  setAuthState(false);
  setStatus(error.message, "danger");
  setAuthStatus(error.message, "danger");
});
