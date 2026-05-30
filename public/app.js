const STORAGE_KEY = "kitty-remote-deck-ui";
const DEBUG_STORAGE_KEY = "kitty-remote-deck-debug";
const CLIENT_BUILD = "0.2.0";
const MOBILE_HISTORY_KEY = "krdMobileScreen";
const FONT_SIZE_RANGE = { min: 5, max: 18, default: 13 };
const THEME_SET = new Set(["dark", "graphite", "light"]);
const TEXT_EXTENT_SET = new Set(["screen", "all"]);
const MOBILE_TERMINAL_WIDTH_SET = new Set(["fit", "wide"]);
const MOBILE_SCREEN_SET = new Set(["connect", "sessions", "chat", "browser"]);
const SIDEBAR_WIDTH_RANGE = { min: 220, max: 520 };
const PANEL_HEIGHT_RANGE = { min: 150, max: 420 };
const BROWSER_WIDTH_RANGE = { min: 320, max: 900, default: 560 };
const AUTO_REFRESH_MS = 5000;
const SESSION_TREE_REFRESH_EVERY_TICKS = 3;
const ALL_TEXT_AUTO_REFRESH_EVERY_TICKS = 3;
const WHEEL_SCROLL_DEBOUNCE_MS = 70;
const WHEEL_SCROLL_MAX_LINES = 80;
const MOBILE_AUTO_CONNECT_DELAY_MS = 1000;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif"
]);
const BROWSER_UTILS = window.KRDBrowserUtils;
const MOBILE_UTILS = window.KRDMobileUtils;
const PREVIEW_HISTORY = window.KRDPreviewHistory;
const COMPOSER_UTILS = window.KRDComposerUtils;

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
  mobileScreen: "connect",
  mobileTerminalWidth: "fit",
  resizeEnabled: false,
  sidebarWidth: 320,
  browserWidth: BROWSER_WIDTH_RANGE.default,
  bottomPanelHeight: 230,
  imageAttachment: null,
  composerSending: false,
  sessionCreating: false
};

const elements = {
  appShell: document.querySelector("#appShell"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authTokenInput: document.querySelector("#authTokenInput"),
  authStatusText: document.querySelector("#authStatusText"),
  authDeviceMeta: document.querySelector("#authDeviceMeta"),
  authToast: document.querySelector("#authToast"),
  authDeviceLabel: document.querySelector("#authDeviceLabel"),
  logoutBtn: document.querySelector("#logoutBtn"),
  showSshViewBtn: document.querySelector("#showSshViewBtn"),
  showSessionsViewBtn: document.querySelector("#showSessionsViewBtn"),
  primarySidebar: document.querySelector("#primarySidebar"),
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
  mobilePaneSwitcher: document.querySelector("#mobilePaneSwitcher"),
  mobileBackToConnectBtn: document.querySelector("#mobileBackToConnectBtn"),
  mobileBackToSessionsBtn: document.querySelector("#mobileBackToSessionsBtn"),
  mobileConnectTargetBtn: document.querySelector("#mobileConnectTargetBtn"),
  mobileTerminalWidthBtn: document.querySelector("#mobileTerminalWidthBtn"),
  editorPane: document.querySelector("#editorPane"),
  viewerMeta: document.querySelector("#viewerMeta"),
  screenOutput: document.querySelector("#screenOutput"),
  bottomPanel: document.querySelector("#bottomPanel"),
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
  mobileBrowserBackBtn: document.querySelector("#mobileBrowserBackBtn"),
  closePreviewBtn: document.querySelector("#closePreviewBtn"),
  reopenPreviewBtn: document.querySelector("#reopenPreviewBtn"),
  urlPreviewFrame: document.querySelector("#urlPreviewFrame"),
  screenModeBtn: document.querySelector("#screenModeBtn"),
  allTextModeBtn: document.querySelector("#allTextModeBtn"),
  refreshTextBtn: document.querySelector("#refreshTextBtn"),
  sendTextBtn: document.querySelector("#sendTextBtn"),
  sendEnterBtn: document.querySelector("#sendEnterBtn"),
  sendEscBtn: document.querySelector("#sendEscBtn"),
  sendCtrlCBtn: document.querySelector("#sendCtrlCBtn"),
  sendCtrlDBtn: document.querySelector("#sendCtrlDBtn"),
  sendForm: document.querySelector("#sendForm"),
  sendTextInput: document.querySelector("#sendTextInput"),
  composerStack: document.querySelector("#composerStack"),
  attachImageHeadBtn: document.querySelector("#attachImageHeadBtn"),
  attachImageBtn: document.querySelector("#attachImageBtn"),
  imageInput: document.querySelector("#imageInput"),
  imageAttachment: document.querySelector("#imageAttachment"),
  imageAttachmentThumb: document.querySelector("#imageAttachmentThumb"),
  imageAttachmentName: document.querySelector("#imageAttachmentName"),
  imageAttachmentInfo: document.querySelector("#imageAttachmentInfo"),
  removeImageBtn: document.querySelector("#removeImageBtn"),
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
let sessionPointerStart = null;
let suppressSessionClickUntil = 0;
let clientDebugEnabled = false;
let clientDebugTimer = null;
let lastClientDebugAt = 0;
let authToastTimer = null;
let mobileAutoConnectTimer = null;
let mobileAutoConnectSuppressed = false;
let mobileAutoConnectInFlight = false;

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

function getDebugParam() {
  return new URLSearchParams(window.location.search).get("debug");
}

function describeElement(element) {
  if (!element) {
    return null;
  }

  return {
    tag: element.tagName,
    id: element.id || "",
    className: typeof element.className === "string" ? element.className : "",
    hidden: Boolean(element.hidden),
    windowId: element.dataset?.windowId || "",
    view: element.dataset?.view || ""
  };
}

function describeBox(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return {
    element: describeElement(element),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom)
    },
    display: style.display,
    visibility: style.visibility,
    pointerEvents: style.pointerEvents,
    position: style.position,
    zIndex: style.zIndex,
    overflow: style.overflow,
    overflowY: style.overflowY,
    touchAction: style.touchAction,
    scrollTop: Math.round(element.scrollTop || 0),
    scrollHeight: Math.round(element.scrollHeight || 0),
    clientHeight: Math.round(element.clientHeight || 0)
  };
}

function getEventPoint(event) {
  const touch = event?.changedTouches?.[0] || event?.touches?.[0];
  if (touch) {
    return { x: touch.clientX, y: touch.clientY };
  }

  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }

  return null;
}

function createDebugSnapshot(eventName, event) {
  const point = getEventPoint(event);
  const center = {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  };
  const hitPoint = point || center;
  const hitElement = document.elementFromPoint(hitPoint.x, hitPoint.y);

  return {
    source: "krd-client-debug",
    build: CLIENT_BUILD,
    event: eventName,
    eventType: event?.type || "",
    point: point ? { x: Math.round(point.x), y: Math.round(point.y) } : null,
    href: window.location.href,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      mobileQuery: isMobileViewport()
    },
    state: {
      authenticated: state.authenticated,
      mobileScreen: state.mobileScreen,
      activeSidebarView: state.activeSidebarView,
      sidebarVisible: state.sidebarVisible,
      previewVisible: state.previewVisible,
      previewPinned: state.previewPinned,
      selectedTargetId: state.selectedTargetId,
      selectedSocket: state.selectedSocket,
      selectedWindowId: state.selectedWindowId,
      flatWindowCount: state.flatWindows.length,
      sessionTreeCount: state.sessionTree.length,
      refreshing: state.refreshing,
      screenExtent: state.screenExtent
    },
    classes: elements.appShell?.className || "",
    activeElement: describeElement(document.activeElement),
    hit: describeElement(hitElement),
    hitPath: hitElement
      ? Array.from(hitElement.closest?.("button, [data-window-id], section, aside, main, div") ? [hitElement.closest("button, [data-window-id], section, aside, main, div")] : [])
          .map(describeElement)
      : [],
    boxes: {
      html: describeBox(document.documentElement),
      body: describeBox(document.body),
      appShell: describeBox(elements.appShell),
      authGate: describeBox(elements.authGate),
      workbench: describeBox(document.querySelector(".workbench")),
      primarySidebar: describeBox(elements.primarySidebar),
      sshSidebarView: describeBox(elements.sshSidebarView),
      sessionsSidebarView: describeBox(elements.sessionsSidebarView),
      sessionTree: describeBox(elements.sessionTree),
      editorRegion: describeBox(document.querySelector(".editor-region")),
      previewDrawer: describeBox(elements.previewDrawer),
      reopenPreviewBtn: describeBox(elements.reopenPreviewBtn)
    }
  };
}

function updateClientDebugOverlay(snapshot) {
  let overlay = document.querySelector("#clientDebugOverlay");
  if (!overlay) {
    overlay = document.createElement("pre");
    overlay.id = "clientDebugOverlay";
    overlay.style.position = "fixed";
    overlay.style.left = "8px";
    overlay.style.right = "8px";
    overlay.style.bottom = "8px";
    overlay.style.zIndex = "10000";
    overlay.style.maxHeight = "34dvh";
    overlay.style.margin = "0";
    overlay.style.padding = "8px";
    overlay.style.overflow = "hidden";
    overlay.style.border = "1px solid rgba(255,255,255,0.28)";
    overlay.style.borderRadius = "6px";
    overlay.style.background = "rgba(0,0,0,0.78)";
    overlay.style.color = "#fff";
    overlay.style.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    overlay.style.pointerEvents = "none";
    document.body.appendChild(overlay);
  }

  overlay.textContent = [
    `KRD ${snapshot.build} ${snapshot.event}`,
    `screen=${snapshot.state.mobileScreen} view=${snapshot.state.activeSidebarView} mobile=${snapshot.viewport.mobileQuery}`,
    `hit=${snapshot.hit?.tag || "-"}#${snapshot.hit?.id || ""}.${snapshot.hit?.className || ""}`,
    `sessions scroll=${snapshot.boxes.sessionsSidebarView?.scrollTop}/${snapshot.boxes.sessionsSidebarView?.scrollHeight}`,
    `tree scroll=${snapshot.boxes.sessionTree?.scrollTop}/${snapshot.boxes.sessionTree?.scrollHeight}`
  ].join("\n");
}

function sendClientDebug(eventName, event, options = {}) {
  if (!clientDebugEnabled) {
    return;
  }

  const now = Date.now();
  if (!options.force && now - lastClientDebugAt < 500) {
    return;
  }
  lastClientDebugAt = now;

  const snapshot = createDebugSnapshot(eventName, event);
  updateClientDebugOverlay(snapshot);

  const payload = JSON.stringify(snapshot);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/client-log", new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch("/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

function initializeClientDebug() {
  const debugParam = getDebugParam();

  try {
    if (debugParam === "off") {
      localStorage.removeItem(DEBUG_STORAGE_KEY);
    } else if (debugParam) {
      localStorage.setItem(DEBUG_STORAGE_KEY, "1");
    }

    clientDebugEnabled = localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
  } catch (error) {
    clientDebugEnabled = Boolean(debugParam && debugParam !== "off");
  }

  if (!clientDebugEnabled) {
    return;
  }

  ["touchstart", "touchmove", "touchend", "pointerdown", "pointerup", "click", "scroll"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => sendClientDebug(eventName, event), {
      capture: true,
      passive: true
    });
  });

  clientDebugTimer = setInterval(() => {
    sendClientDebug("heartbeat", null, { force: true });
  }, 2000);
  sendClientDebug("init", null, { force: true });
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
    state.mobileTerminalWidth = MOBILE_TERMINAL_WIDTH_SET.has(parsed.mobileTerminalWidth)
      ? parsed.mobileTerminalWidth
      : "fit";
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
    state.mobileTerminalWidth = "fit";
    state.mobileScreen = "connect";
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
      mobileTerminalWidth: state.mobileTerminalWidth,
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

function isMobileViewport() {
  return MOBILE_UTILS.isMobileViewport();
}

function getMobileHistoryScreen() {
  return MOBILE_UTILS.getHistoryScreen(history.state, MOBILE_HISTORY_KEY, MOBILE_SCREEN_SET);
}

function syncMobileHistory(screen, mode = "push") {
  if (!isMobileViewport()) {
    return;
  }

  MOBILE_UTILS.syncHistory({
    screen,
    mode,
    key: MOBILE_HISTORY_KEY,
    allowedScreens: MOBILE_SCREEN_SET,
    historyObject: history,
    href: window.location.href
  });
}

function setMobileScreen(screen, options = {}) {
  const nextScreen = MOBILE_SCREEN_SET.has(screen) ? screen : "connect";
  state.mobileScreen = nextScreen;

  if (isMobileViewport() && ["connect", "sessions"].includes(nextScreen)) {
    state.previewVisible = false;
    state.previewPinned = false;
  }

  if (nextScreen === "connect") {
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  } else if (nextScreen === "sessions") {
    state.activeSidebarView = "sessions";
    state.sidebarVisible = true;
  } else {
    state.sidebarVisible = false;
  }

  applyUiState();
  if (options.history !== false) {
    syncMobileHistory(nextScreen, options.history || "push");
  }
  sendClientDebug(`setMobileScreen:${nextScreen}`, null, { force: true });
}

function cancelMobileAutoConnect(options = {}) {
  if (mobileAutoConnectTimer) {
    clearTimeout(mobileAutoConnectTimer);
    mobileAutoConnectTimer = null;
  }

  if (options.suppress) {
    mobileAutoConnectSuppressed = true;
  }
}

function scheduleMobileAutoConnect(options = {}) {
  cancelMobileAutoConnect();

  if (options.resetSuppression) {
    mobileAutoConnectSuppressed = false;
  }

  if (
    mobileAutoConnectSuppressed ||
    !isMobileViewport() ||
    !state.authenticated ||
    !state.selectedTargetId
  ) {
    return;
  }

  mobileAutoConnectTimer = setTimeout(async () => {
    mobileAutoConnectTimer = null;

    if (
      mobileAutoConnectSuppressed ||
      mobileAutoConnectInFlight ||
      !state.authenticated ||
      !state.selectedTargetId ||
      state.mobileScreen !== "connect"
    ) {
      return;
    }

    mobileAutoConnectInFlight = true;
    setStatus("Auto Connect: connecting to the last target...", "neutral");

    try {
      await connectSelectedTarget({ source: "auto" });
    } catch (error) {
      setTargetHealth("Auto Connect failed", "danger");
      setStatus(`Auto Connect failed: ${error.message}`, "danger");
    } finally {
      mobileAutoConnectInFlight = false;
    }
  }, MOBILE_AUTO_CONNECT_DELAY_MS);
}

function handleMobileBack(targetScreen) {
  if (targetScreen === "connect") {
    cancelMobileAutoConnect({ suppress: true });
  }
  setMobileScreen(targetScreen, { history: "replace" });
}

function refreshPaneAfterMobileReturn() {
  if (
    !isMobileViewport() ||
    state.mobileScreen !== "chat" ||
    !state.selectedTargetId ||
    !state.selectedWindowId
  ) {
    return;
  }

  refreshScreen({
    force: true,
    scrollToBottom: state.screenExtent === "all" && state.allTextFollowTail
  }).catch((error) => setStatus(error.message, "danger"));
}

function handleMobileHistoryChange(event) {
  if (!isMobileViewport()) {
    return;
  }

  const screen = event.state?.[MOBILE_HISTORY_KEY];
  const nextScreen = MOBILE_SCREEN_SET.has(screen) ? screen : "connect";

  if (nextScreen === "connect") {
    cancelMobileAutoConnect({ suppress: true });
  }

  if (nextScreen === "browser") {
    state.previewVisible = Boolean(state.previewUrl);
    setMobileScreen("browser", { history: false });
    syncPreviewFrame();
    return;
  }

  if (state.previewVisible && nextScreen === "chat") {
    state.previewVisible = false;
  }

  setMobileScreen(nextScreen, { history: false });
  if (nextScreen === "chat") {
    refreshPaneAfterMobileReturn();
  }
}

function applyUiState() {
  if (isMobileViewport()) {
    state.sidebarVisible = state.mobileScreen !== "chat";
    if (state.mobileScreen === "connect") {
      state.activeSidebarView = "ssh";
    } else if (state.mobileScreen === "sessions") {
      state.activeSidebarView = "sessions";
    }
  }

  const showingSsh = state.activeSidebarView === "ssh";
  const showingSessions = state.activeSidebarView === "sessions";
  elements.sshSidebarView.hidden = !showingSsh;
  elements.sessionsSidebarView.hidden = !showingSessions;
  elements.appShell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
  elements.appShell.classList.toggle("preview-open", state.previewVisible);
  elements.appShell.classList.toggle("browser-pinned", state.previewVisible && state.previewPinned);
  elements.appShell.classList.toggle("mobile-screen-connect", state.mobileScreen === "connect");
  elements.appShell.classList.toggle("mobile-screen-sessions", state.mobileScreen === "sessions");
  elements.appShell.classList.toggle("mobile-screen-chat", state.mobileScreen === "chat");
  elements.appShell.classList.toggle("mobile-screen-browser", state.mobileScreen === "browser");
  elements.appShell.classList.toggle("mobile-terminal-wide", state.mobileTerminalWidth === "wide");
  elements.showSshViewBtn.classList.toggle("active", state.sidebarVisible && showingSsh);
  elements.showSessionsViewBtn.classList.toggle("active", state.sidebarVisible && showingSessions);
  elements.showSshViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSsh));
  elements.showSessionsViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSessions));
  elements.appShell.classList.toggle("resize-enabled", state.resizeEnabled);
  elements.previewDrawer.setAttribute("aria-hidden", String(!state.previewVisible));
  elements.reopenPreviewBtn.hidden = state.previewVisible || !state.previewUrl;
  elements.reopenPreviewBtn.setAttribute("aria-hidden", String(state.previewVisible || !state.previewUrl));
  elements.browserBackBtn.disabled = state.previewHistoryIndex < 0;
  elements.browserForwardBtn.disabled = state.previewHistoryIndex < 0 || state.previewHistoryIndex >= state.previewHistory.length - 1;
  elements.browserGoBtn.disabled = !state.selectedTargetId;
  elements.pinBrowserBtn.classList.toggle("active", state.previewPinned);
  elements.pinBrowserBtn.setAttribute("aria-pressed", String(state.previewPinned));
  elements.pinBrowserBtn.title = state.previewPinned ? "Unpin Browser" : "Pin Browser";
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
  elements.mobileTerminalWidthBtn.classList.toggle("active", state.mobileTerminalWidth === "wide");
  elements.mobileTerminalWidthBtn.setAttribute("aria-pressed", String(state.mobileTerminalWidth === "wide"));
  elements.mobileTerminalWidthBtn.textContent = state.mobileTerminalWidth === "wide" ? "Wide" : "Fit";
  elements.mobileTerminalWidthBtn.title = state.mobileTerminalWidth === "wide"
    ? "Keep the terminal's original width and allow horizontal scrolling"
    : "Fit terminal text to the phone width";
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
  return BROWSER_UTILS.createPreviewResourceUrl(url, targetId);
}

function normalizeBrowserUrl(rawUrl) {
  return BROWSER_UTILS.normalizeBrowserUrl(rawUrl);
}

function getPreviewHistoryState() {
  return PREVIEW_HISTORY.createState(state.previewHistory, state.previewHistoryIndex, state.previewUrl);
}

function applyPreviewHistoryState(nextState) {
  if (!nextState) {
    return false;
  }

  state.previewHistory = nextState.items;
  state.previewHistoryIndex = nextState.index;
  state.previewUrl = nextState.url;
  return true;
}

function rememberPreviewUrl(url, mode = "push") {
  applyPreviewHistoryState(PREVIEW_HISTORY.remember(getPreviewHistoryState(), url, mode));
}

function replaceLoadedPreviewUrl(url) {
  applyPreviewHistoryState(PREVIEW_HISTORY.replaceLoaded(getPreviewHistoryState(), url));
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

function getAuthDeviceText(device) {
  if (!device) {
    return "";
  }

  const label = device.label || "Unnamed device";
  const preview = device.tokenPreview ? ` · ${device.tokenPreview}` : "";
  return `${label}${preview}`;
}

function setAuthDeviceMeta(device, fallback = "Enter the token for this device.") {
  elements.authDeviceMeta.textContent = device
    ? `Current key: ${getAuthDeviceText(device)}`
    : fallback;
}

function showAuthToast(message, mode = "success") {
  if (authToastTimer) {
    clearTimeout(authToastTimer);
  }

  elements.authToast.textContent = message;
  elements.authToast.dataset.mode = mode;
  elements.authToast.hidden = false;

  authToastTimer = setTimeout(() => {
    elements.authToast.hidden = true;
  }, 3200);
}

function setAuthState(authenticated, device = null) {
  state.authenticated = Boolean(authenticated);
  state.authDevice = state.authenticated ? device : null;
  elements.authGate.hidden = state.authenticated;
  elements.authDeviceLabel.hidden = !state.authenticated;
  elements.logoutBtn.hidden = !state.authenticated;
  elements.authDeviceLabel.textContent = state.authDevice ? `Key: ${getAuthDeviceText(state.authDevice)}` : "";
  setAuthDeviceMeta(state.authDevice);

  if (!state.authenticated && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (!state.authenticated) {
    cancelMobileAutoConnect({ suppress: true });
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
    output.innerHTML = linkifyTerminalText(state.screenText || "(current screen is empty)");
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

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function getImageMimeType(file) {
  return String(file?.type || "").split(";")[0].trim().toLowerCase();
}

function validateImageFile(file) {
  if (!file) {
    throw new Error("No image selected.");
  }

  const mimeType = getImageMimeType(file);
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("Only PNG, JPEG, WebP, GIF, HEIC, or HEIF images are supported.");
  }

  if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`Image is too large. The current limit is ${Math.floor(MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024)} MiB.`);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("Failed to read image.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function getBase64FromDataUrl(dataUrl) {
  const marker = ";base64,";
  const index = dataUrl.indexOf(marker);
  return index >= 0 ? dataUrl.slice(index + marker.length) : dataUrl;
}

function renderImageAttachment() {
  const attachment = state.imageAttachment;
  elements.bottomPanel.classList.toggle("has-image-attachment", Boolean(attachment));
  elements.sendForm.classList.toggle("has-image-attachment", Boolean(attachment));

  if (!attachment) {
    elements.imageAttachment.hidden = true;
    elements.imageAttachmentThumb.removeAttribute("src");
    elements.imageAttachmentName.textContent = "image";
    elements.imageAttachmentInfo.textContent = "Ready";
    return;
  }

  elements.imageAttachment.hidden = false;
  elements.imageAttachmentThumb.src = attachment.dataUrl;
  elements.imageAttachmentName.textContent = attachment.name;
  elements.imageAttachmentInfo.textContent = `${attachment.type} · ${formatBytes(attachment.size)}`;
}

function setComposerBusy(isBusy) {
  state.composerSending = Boolean(isBusy);
  elements.sendForm.classList.toggle("composer-busy", state.composerSending);
  elements.sendForm.setAttribute("aria-busy", String(state.composerSending));
  elements.sendTextBtn.disabled = state.composerSending;
  elements.sendEnterBtn.disabled = state.composerSending;
  elements.sendEscBtn.disabled = state.composerSending;
  elements.sendCtrlCBtn.disabled = state.composerSending;
  elements.sendCtrlDBtn.disabled = state.composerSending;
  elements.attachImageHeadBtn.disabled = state.composerSending;
  elements.attachImageBtn.disabled = state.composerSending;
  elements.removeImageBtn.disabled = state.composerSending;
  elements.imageInput.disabled = state.composerSending;
  elements.sendTextBtn.textContent = state.composerSending ? "Sending" : "Send";
}

async function attachImageFile(file) {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Add the image after it finishes.", "neutral");
    return;
  }

  validateImageFile(file);
  const dataUrl = await readFileAsDataUrl(file);
  state.imageAttachment = {
    name: file.name || "image",
    type: getImageMimeType(file),
    size: file.size,
    dataUrl,
    base64: getBase64FromDataUrl(dataUrl)
  };
  renderImageAttachment();
  setStatus(`Image ${state.imageAttachment.name} attached.`, "success");
}

function clearImageAttachment() {
  state.imageAttachment = null;
  elements.imageInput.value = "";
  renderImageAttachment();
}

function getImageFileFromDataTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  return files.find((file) => getImageMimeType(file).startsWith("image/")) || null;
}

function openImagePicker() {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Add the image after it finishes.", "neutral");
    return;
  }
  elements.imageInput.click();
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    setAuthState(false);
    setAuthStatus("Sign-in expired. Enter this device's token again.", "danger");
    throw new Error(payload.error || "Authentication required.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function checkAuthStatus() {
  setAuthState(false);
  setAuthStatus("Checking saved sign-in state...", "neutral");
  setAuthDeviceMeta(null, "If this device is already signed in, the workspace will open automatically.");
  const payload = await apiFetch("/api/auth/status");
  setAuthState(Boolean(payload.authenticated), payload.device || null);
  if (state.authenticated) {
    const deviceText = getAuthDeviceText(state.authDevice);
    setAuthStatus(`Authenticated: ${deviceText}`, "success");
    showAuthToast(`Authenticated: ${deviceText}`);
  } else {
    setAuthStatus("Authentication required: enter this device's token.", "neutral");
    setAuthDeviceMeta(null, "Not authenticated. Enter the token created for this device.");
  }
  return state.authenticated;
}

async function loginWithDeviceToken() {
  const token = elements.authTokenInput.value.trim();

  if (!token) {
    setAuthStatus("Enter a device token.", "danger");
    return;
  }

  const payload = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });

  elements.authTokenInput.value = "";
  setAuthState(true, payload.device);
  const deviceText = getAuthDeviceText(payload.device);
  setAuthStatus(`Authenticated: ${deviceText}`, "success");
  showAuthToast(`Authenticated: ${deviceText}`);
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
  setAuthStatus("Signed out. Enter a device token to sign in again.", "neutral");
  setAuthDeviceMeta(null, "No authenticated key is active.");
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
  elements.targetSsh.placeholder = isSsh ? "ssh-host" : "Local targets do not need an SSH host";
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
    elements.targetSelect.innerHTML = `<option value="">No saved targets</option>`;
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
    elements.savedTargets.innerHTML = `<p class="empty-note">No saved targets yet.</p>`;
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
      setTargetHealth("Ready to connect", "neutral");
      await apiFetch("/api/targets/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId })
      });
      setStatus(`Switched to ${target.name}; the top selector is synced.`, "neutral");
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

function getFirstWindowInTab(tab) {
  return (tab?.windows || [])[0] || null;
}

function getFirstWindowInOsWindow(osWindow) {
  for (const tab of osWindow?.tabs || []) {
    const windowInfo = getFirstWindowInTab(tab);
    if (windowInfo) {
      return windowInfo;
    }
  }
  return null;
}

function getCreatePanelLabel(kind) {
  if (kind === "tab") return "tab";
  if (kind === "split") return "split";
  return "window";
}

function syncSessionCreateControls() {
  const buttons = Array.from(elements.sessionTree.querySelectorAll("[data-create-session]"));

  buttons.forEach((button) => {
    const lacksAnchor = button.dataset.createSession && !button.dataset.sourceWindowId;
    const kind = button.dataset.createSession || "";
    button.disabled = state.sessionCreating || lacksAnchor || !state.selectedTargetId;
    if (kind === "window") {
      button.disabled = state.sessionCreating || !state.selectedTargetId;
    }
  });
}

async function createKittyPanel(kind, context = {}) {
  if (!state.selectedTargetId) {
    setStatus("Choose a connection target first.", "warning");
    return;
  }

  if (state.sessionCreating) {
    setStatus("A Kitty create action is already running.", "neutral");
    return;
  }

  const payload = {
    targetId: state.selectedTargetId,
    socket: state.selectedSocket || "",
    kind
  };

  if (context.sourceWindowId) {
    payload.sourceWindowId = Number(context.sourceWindowId);
  }
  if (context.tabId) {
    payload.tabId = Number(context.tabId);
  }

  const label = getCreatePanelLabel(kind);
  state.sessionCreating = true;
  syncSessionCreateControls();
  setStatus(`Creating new ${label}...`, "neutral");

  try {
    const result = await apiFetch("/api/create-panel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (result.socket) {
      state.selectedSocket = result.socket;
    }

    await loadSessions({ forceRefresh: true, refreshPane: false });
    if (result.windowId) {
      await selectWindow(result.windowId);
    }
    setStatus(`Created new ${label} #${result.windowId || ""}.`, "success");
  } finally {
    state.sessionCreating = false;
    syncSessionCreateControls();
  }
}

async function selectWindow(windowId) {
  state.selectedWindowId = Number(windowId);
  if (isMobileViewport()) {
    state.previewVisible = false;
    state.previewPinned = false;
    setMobileScreen("chat");
  }
  invalidateScreenRequests();
  renderSessions();
  renderMobilePaneSwitcher();
  renderViewerMeta();
  applyUiState();
  await refreshScreen({
    force: true,
    scrollToBottom: state.screenExtent === "all" && state.allTextFollowTail,
    scrollToTop: state.screenExtent === "screen"
  });
}

function renderMobilePaneSwitcher() {
  if (!state.flatWindows.length) {
    elements.mobilePaneSwitcher.hidden = true;
    elements.mobilePaneSwitcher.innerHTML = "";
    return;
  }

  elements.mobilePaneSwitcher.hidden = false;
  elements.mobilePaneSwitcher.innerHTML = state.flatWindows
    .map((windowInfo) => {
      const selected = Number(windowInfo.id) === Number(state.selectedWindowId) ? "selected" : "";
      const title = [
        windowInfo.title || `Pane ${windowInfo.id}`,
        windowInfo.tabTitle ? `Tab: ${windowInfo.tabTitle}` : "",
        windowInfo.cwd || ""
      ].filter(Boolean).join(" · ");
      return `
        <button class="mobile-pane-tab ${selected}" type="button" data-mobile-window-id="${windowInfo.id}" title="${escapeAttribute(title)}">
          ID ${escapeHtml(String(windowInfo.id))}
        </button>
      `;
    })
    .join("");

  elements.mobilePaneSwitcher.querySelectorAll("[data-mobile-window-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectWindow(button.dataset.mobileWindowId);
    });
  });

  const selectedButton = elements.mobilePaneSwitcher.querySelector(".mobile-pane-tab.selected");
  if (selectedButton) {
    const targetLeft = selectedButton.offsetLeft - (elements.mobilePaneSwitcher.clientWidth - selectedButton.clientWidth) / 2;
    elements.mobilePaneSwitcher.scrollLeft = Math.max(0, targetLeft);
  }
}

function bindSessionCreateControls() {
  elements.sessionTree.querySelectorAll("[data-create-session]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await createKittyPanel(button.dataset.createSession, {
          sourceWindowId: button.dataset.sourceWindowId,
          tabId: button.dataset.tabId
        });
      } catch (error) {
        setTargetHealth("Create failed", "danger");
        setStatus(error.message, "danger");
      }
    });
  });

  syncSessionCreateControls();
}

function renderSessions() {
  const totalWindows = state.flatWindows.length;
  const selectedTarget = getSelectedTarget();
  const newWindowFooter = `
    <section class="os-window-create-block">
      <button
        class="ghost-button session-create-button create-window-card-button"
        id="createWindowBtn"
        type="button"
        data-create-session="window"
      >
        <span>New Window</span>
        <small>Create OS Window #${state.sessionTree.length + 1}</small>
      </button>
    </section>
  `;

  elements.sessionSummary.textContent = selectedTarget
    ? `${selectedTarget.name} · ${state.sessionTree.length} OS windows / ${totalWindows} panes`
    : "Choose a target from the top selector, then connect.";

  if (!state.sessionTree.length) {
    elements.sessionTree.innerHTML = `
      <div class="empty-note">No kitty session data yet. Click Connect to load sessions.</div>
      ${newWindowFooter}
    `;
    renderMobilePaneSwitcher();
    bindSessionCreateControls();
    return;
  }

  const markup = state.sessionTree
    .map((osWindow) => {
      const osWindowAnchor = getFirstWindowInOsWindow(osWindow);
      const tabCreateDisabled = osWindowAnchor ? "" : "disabled";
      const tabs = (osWindow.tabs || [])
        .map((tab) => {
          const tabAnchor = getFirstWindowInTab(tab);
          const splitCreateDisabled = tabAnchor ? "" : "disabled";
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
                <div class="session-head-actions">
                  <span>tab #${tab.id}</span>
                  <button
                    class="ghost-button session-create-button"
                    type="button"
                    data-create-session="split"
                    data-tab-id="${escapeAttribute(tab.id)}"
                    data-source-window-id="${escapeAttribute(tabAnchor?.id || "")}"
                    ${splitCreateDisabled}
                  >New Split</button>
                </div>
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
              <small>${osWindow.is_focused ? "focused now" : "background window"}</small>
            </div>
            <div class="session-head-actions">
              <span>${(osWindow.tabs || []).length} tabs</span>
              <button
                class="ghost-button session-create-button"
                type="button"
                data-create-session="tab"
                data-os-window-id="${escapeAttribute(osWindow.id)}"
                data-source-window-id="${escapeAttribute(osWindowAnchor?.id || "")}"
                ${tabCreateDisabled}
              >New Tab</button>
            </div>
          </div>
          ${tabs}
        </section>
      `;
    })
    .join("");

  elements.sessionTree.innerHTML = `${markup}${newWindowFooter}`;

  elements.sessionTree.querySelectorAll("[data-window-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (Date.now() < suppressSessionClickUntil) {
        return;
      }
      await selectWindow(button.dataset.windowId);
    });
  });

  renderMobilePaneSwitcher();
  bindSessionCreateControls();
}

function getSessionPaneFromEvent(event) {
  return event.target.closest?.("[data-window-id]") || null;
}

function handleSessionPointerDown(event) {
  const pane = getSessionPaneFromEvent(event);
  if (!pane || !["touch", "pen"].includes(event.pointerType)) {
    sessionPointerStart = null;
    return;
  }

  sessionPointerStart = {
    pointerId: event.pointerId,
    windowId: pane.dataset.windowId,
    x: event.clientX,
    y: event.clientY,
    time: Date.now()
  };
}

async function handleSessionPointerUp(event) {
  if (!sessionPointerStart || sessionPointerStart.pointerId !== event.pointerId) {
    return;
  }

  const start = sessionPointerStart;
  sessionPointerStart = null;
  const pane = getSessionPaneFromEvent(event);
  const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  const elapsed = Date.now() - start.time;

  if (!pane || pane.dataset.windowId !== start.windowId || moved > 14 || elapsed > 900) {
    return;
  }

  suppressSessionClickUntil = Date.now() + 650;
  event.preventDefault();
  await selectWindow(start.windowId);
}

function renderSocketOptions(sockets, selectedSocket) {
  const safeSockets = sockets?.length ? sockets : [""];
  elements.socketSelect.innerHTML = safeSockets
    .map((socket) => {
      const label = socket || "Auto-select latest socket";
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
    elements.viewerMeta.textContent = "Select a pane to show its title and directory.";
    return;
  }

  elements.viewerMeta.innerHTML = `
    <strong>${escapeHtml(windowInfo.title || `Pane ${windowInfo.id}`)}</strong>
    <span>pane #${windowInfo.id}</span>
    <span>${escapeHtml(windowInfo.cwd || "")}</span>
  `;
}

function closePreview() {
  if (isMobileViewport() && state.previewVisible && getMobileHistoryScreen() === "browser") {
    history.back();
    return;
  }

  state.previewVisible = false;
  if (isMobileViewport() && state.mobileScreen === "browser") {
    state.mobileScreen = "chat";
  }
  applyUiState();
  refreshPaneAfterMobileReturn();
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
    setPreviewStatus("No Browser URL yet.", "neutral");
    return;
  }

  state.previewVisible = true;
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

function goBackPreview() {
  const nextHistory = PREVIEW_HISTORY.goBack(getPreviewHistoryState());
  if (!nextHistory) {
    closePreview();
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

function goForwardPreview() {
  const nextHistory = PREVIEW_HISTORY.goForward(getPreviewHistoryState());
  if (!nextHistory) {
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

function jumpPreviewHistory(index) {
  const nextHistory = PREVIEW_HISTORY.jump(getPreviewHistoryState(), index);
  if (!nextHistory) {
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function loadUrlPreview(rawUrl, options = {}) {
  const target = getSelectedTarget();

  if (!target) {
    setPreviewStatus("Choose a connection target first.", "warning");
    return;
  }

  const url = normalizeBrowserUrl(rawUrl);

  rememberPreviewUrl(url, options.history || "push");
  state.previewVisible = true;
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    setPreviewStatus(`Opening ${url} through ${target.name}...`, "neutral");
    return;
  }
  applyUiState();
  setPreviewStatus(`Opening ${url} through ${target.name}...`, "neutral");
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
  if (isMobileViewport() && state.mobileScreen === "browser") {
    state.mobileScreen = "chat";
  }
  applyUiState();
  refreshPaneAfterMobileReturn();
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
      setPreviewStatus(`Loaded ${url}`, "neutral");
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
  state.imageAttachment = null;
  if (isMobileViewport()) {
    state.mobileScreen = "connect";
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  }
  renderSocketOptions([], "");
  renderSessions();
  renderViewerMeta();
  renderImageAttachment();
  elements.screenOutput.textContent = "Waiting for a kitty pane...";
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
  setStatus(`Target ${data.target.name} saved. You can switch to it from the top selector.`, "success");
}

async function testTargetRequest(requestBody) {
  const result = await apiFetch("/api/targets/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  setTargetHealth("Connection OK", "success");
  renderSocketOptions(result.sockets || [], result.selectedSocket || "");
  state.selectedSocket = result.selectedSocket || "";
  setStatus(
    `${result.host} / ${result.user}: found ${result.sockets.length} sockets and ${result.windowCount} panes.`,
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

async function connectSelectedTarget(options = {}) {
  if (!state.selectedTargetId) {
    setStatus("Save a connection target first.", "warning");
    return;
  }

  if (options.source !== "auto") {
    cancelMobileAutoConnect({ suppress: true });
  }

  sendClientDebug("connectSelectedTarget:start", null, { force: true });
  await testTargetRequest({
    targetId: state.selectedTargetId,
    socket: state.selectedSocket || ""
  });
  await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
  if (isMobileViewport()) {
    setMobileScreen("sessions");
  }
  sendClientDebug("connectSelectedTarget:done", null, { force: true });
}

async function loadSessions(options = {}) {
  if (!state.selectedTargetId) {
    setStatus("Choose a connection target from the top selector first.", "warning");
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
  const deferPaneRefresh = isMobileViewport() && state.mobileScreen !== "chat";
  state.sessionTree = data.tree || [];
  state.flatWindows = flattenWindows(state.sessionTree);
  state.selectedSocket = data.selectedSocket || "";
  renderSocketOptions(data.sockets || [], state.selectedSocket);

  if (deferPaneRefresh && state.selectedWindowId) {
    if (!state.flatWindows.some((window) => Number(window.id) === Number(state.selectedWindowId))) {
      state.selectedWindowId = null;
    }
  } else if (!deferPaneRefresh && !state.selectedWindowId && state.flatWindows[0]) {
    state.selectedWindowId = Number(state.flatWindows[0].id);
  } else if (
    !deferPaneRefresh &&
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
  setTargetHealth("Connected", "success");
  updateStatusBar();
  sendClientDebug("loadSessions:rendered", null, { force: true });

  if (state.selectedWindowId && !deferPaneRefresh) {
    if (options.refreshPane !== false) {
      await refreshScreen({
        force: Boolean(options.forceRefresh),
        scrollToBottom: Boolean(options.scrollToBottom)
      });
    } else if (selectedWindowChanged) {
      state.screenText = "";
      elements.screenOutput.textContent = "The current pane changed. Click Refresh to update content.";
    }
  } else if (!state.selectedWindowId) {
    elements.screenOutput.textContent = deferPaneRefresh
      ? "Select a session before loading pane content."
      : "No pane is available to display.";
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
    setStatus("Select a pane first.", "warning");
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
      setStatus(`Scrolled pane #${state.selectedWindowId} by ${Math.abs(lines)} lines.`, "success");
    }
  } finally {
    if (requestSerial === screenRequestSerial) {
      state.refreshing = false;
    }
  }
}

async function sendText(options = {}) {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  const text = elements.sendTextInput.value;
  if (text.length === 0) {
    setStatus("Type something before sending.", "warning");
    return false;
  }

  await apiFetch("/api/send-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: state.selectedTargetId,
      socket: state.selectedSocket,
      windowId: state.selectedWindowId,
      text,
      appendNewline: Boolean(options.appendNewline)
    })
  });

  setStatus(
    options.appendNewline
      ? `Text sent to pane #${state.selectedWindowId} and submitted.`
      : `Text sent to pane #${state.selectedWindowId}.`,
    "success"
  );
  elements.sendTextInput.value = "";
  await refreshScreen({ scrollToBottom: true });
  return true;
}

async function sendImageAttachment(options = {}) {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  const attachment = state.imageAttachment;
  if (!attachment) {
    setStatus("Attach an image first.", "warning");
    return false;
  }

  const text = elements.sendTextInput.value;
  setStatus(`Uploading and sending ${attachment.name}...`, "neutral");
  const data = await apiFetch("/api/send-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: state.selectedTargetId,
      socket: state.selectedSocket,
      windowId: state.selectedWindowId,
      text,
      imageBase64: attachment.base64,
      fileName: attachment.name,
      mimeType: attachment.type,
      appendNewline: Boolean(options.appendNewline)
    })
  });

  setStatus(
    options.appendNewline
      ? `Image ${attachment.name} sent and submitted.`
      : `Image ${attachment.name} sent.`,
    "success"
  );
  elements.sendTextInput.value = "";
  clearImageAttachment();
  await refreshScreen({ scrollToBottom: true });
  return data;
}

async function sendComposerPayload(options = {}) {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Please wait.", "neutral");
    return false;
  }

  setComposerBusy(true);
  try {
    if (state.imageAttachment) {
      return await sendImageAttachment(options);
    }

    return await sendText(options);
  } finally {
    setComposerBusy(false);
  }
}

async function sendKey(key) {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("Select a pane first.", "warning");
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

  setStatus(`Sent key ${key} to pane #${state.selectedWindowId}.`, "success");
  await refreshScreen({ scrollToBottom: true });
}

async function focusWindow() {
  if (!state.selectedTargetId || !state.selectedWindowId) {
    setStatus("Select a pane first.", "warning");
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

  setStatus(`Requested focus for pane #${state.selectedWindowId}.`, "success");
}

async function sendComposerShortcut() {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Please wait.", "neutral");
    return;
  }

  const action = COMPOSER_UTILS.getEnterAction(elements.sendTextInput.value, {
    hasImage: Boolean(state.imageAttachment)
  });

  if (action.type === "send-composer") {
    await sendComposerPayload({ appendNewline: action.appendNewline });
    return;
  }

  if (action.type === "send-text") {
    await sendText({ appendNewline: action.appendNewline });
    return;
  }

  if (action.type === "send-key") {
    await sendKey(action.key);
  }
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
      ? "Switched to All: showing screen + scrollback; wheel scrolls in the browser."
      : "Switched to Screen: wheel controls the kitty viewport.",
    "neutral"
  );
}

function resetTargetDraft() {
  cancelMobileAutoConnect({ suppress: true });
  state.editingTargetId = "";
  writeTargetForm(DEFAULT_TARGET_FORM);
  setTargetHealth("Ready to connect", "neutral");
  setStatus("Creating a new target. Save it to make it available in the top selector.", "neutral");
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
      setTargetHealth("Connection issue", "danger");
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
  return BROWSER_UTILS.escapeHtml(text);
}

function escapeAttribute(text) {
  return BROWSER_UTILS.escapeAttribute(text);
}

function trimUrlPunctuation(url) {
  return BROWSER_UTILS.trimUrlPunctuation(url);
}

function linkifyTerminalText(text) {
  return BROWSER_UTILS.linkifyTerminalText(text);
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
      setAuthStatus("Signing in...", "neutral");
      await loginWithDeviceToken();
    } catch (error) {
      if (!state.authenticated) {
        setAuthState(false);
        setAuthStatus(`Authentication failed: ${error.message}`, "danger");
        setAuthDeviceMeta(null, "Confirm that the token belongs to this device, or ask an administrator to create or rotate it.");
      } else {
        setAuthStatus(`Authenticated, but workspace loading failed: ${error.message}`, "danger");
        showAuthToast(`Workspace loading failed: ${error.message}`, "danger");
      }
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
      setStatus("Target list refreshed.", "neutral");
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

  elements.mobileBackToConnectBtn.addEventListener("click", () => {
    handleMobileBack("connect");
  });

  elements.mobileBackToSessionsBtn.addEventListener("click", () => {
    handleMobileBack("sessions");
  });

  elements.mobileConnectTargetBtn.addEventListener("click", async () => {
    try {
      await connectSelectedTarget();
    } catch (error) {
      setTargetHealth("Connection failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.mobileTerminalWidthBtn.addEventListener("click", () => {
    state.mobileTerminalWidth = state.mobileTerminalWidth === "wide" ? "fit" : "wide";
    applyUiState();
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
    cancelMobileAutoConnect({ suppress: true });
    try {
      await testDraftTarget();
    } catch (error) {
      setTargetHealth("Test failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.connectTargetBtn.addEventListener("click", async () => {
    try {
      await connectSelectedTarget();
    } catch (error) {
      setTargetHealth("Connection failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.reloadSessionsBtn.addEventListener("click", async () => {
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setTargetHealth("Refresh failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.reloadSessionTreeBtn.addEventListener("click", async () => {
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setTargetHealth("Refresh failed", "danger");
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
    setTargetHealth("Switching", "neutral");

    try {
      await apiFetch("/api/targets/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: state.selectedTargetId })
      });
      setStatus(`Switched to ${target.name}.`, "neutral");
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
      if (isMobileViewport()) {
        setMobileScreen("sessions");
      }
    } catch (error) {
      setTargetHealth("Switch failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.socketSelect.addEventListener("change", async () => {
    invalidateSessionRequests();
    state.selectedSocket = elements.socketSelect.value;
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: state.screenExtent === "all" });
    } catch (error) {
      setTargetHealth("Switch failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.sidebarResizeHandle.addEventListener("pointerdown", (event) => startResize("sidebar", event));
  elements.panelResizeHandle.addEventListener("pointerdown", (event) => startResize("panel", event));
  elements.browserResizeHandle.addEventListener("pointerdown", (event) => startResize("browser", event));
  elements.sessionTree.addEventListener("pointerdown", handleSessionPointerDown);
  elements.sessionTree.addEventListener("pointerup", (event) => {
    handleSessionPointerUp(event).catch((error) => setStatus(error.message, "danger"));
  });
  elements.sessionTree.addEventListener("pointercancel", () => {
    sessionPointerStart = null;
  });

  elements.screenOutput.addEventListener("wheel", queueRemoteScrollFromWheel, { passive: false });
  elements.screenOutput.addEventListener("scroll", handleScreenOutputScroll, { passive: true });
  elements.screenOutput.addEventListener("click", async (event) => {
    const link = event.target.closest?.("[data-preview-url]");
    if (!link) {
      return;
    }

    event.preventDefault();

    try {
      await loadUrlPreview(link.dataset.previewUrl, { history: "reset" });
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
  });

  elements.closePreviewBtn.addEventListener("click", closePreview);
  elements.mobileBrowserBackBtn.addEventListener("click", closePreview);
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
      elements.previewAddress.textContent = `Loaded ${state.previewUrl}`;
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
      await sendComposerPayload();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.attachImageHeadBtn.addEventListener("click", openImagePicker);
  elements.attachImageBtn.addEventListener("click", openImagePicker);

  elements.imageInput.addEventListener("change", async () => {
    const file = elements.imageInput.files?.[0];
    try {
      await attachImageFile(file);
    } catch (error) {
      elements.imageInput.value = "";
      setStatus(error.message, "danger");
    }
  });

  elements.removeImageBtn.addEventListener("click", () => {
    clearImageAttachment();
    setStatus("Pending image removed.", "neutral");
  });

  elements.sendTextInput.addEventListener("paste", async (event) => {
    const file = getImageFileFromDataTransfer(event.clipboardData);
    if (!file) {
      return;
    }

    event.preventDefault();
    try {
      await attachImageFile(file);
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendForm.addEventListener("dragover", (event) => {
    if (getImageFileFromDataTransfer(event.dataTransfer)) {
      event.preventDefault();
      elements.sendForm.classList.add("dragging-image");
    }
  });

  elements.sendForm.addEventListener("dragleave", () => {
    elements.sendForm.classList.remove("dragging-image");
  });

  elements.sendForm.addEventListener("drop", async (event) => {
    const file = getImageFileFromDataTransfer(event.dataTransfer);
    if (!file) {
      return;
    }

    event.preventDefault();
    elements.sendForm.classList.remove("dragging-image");
    try {
      await attachImageFile(file);
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendTextInput.addEventListener("keydown", async (event) => {
    if (!COMPOSER_UTILS.shouldSubmitOnKeydown(event)) {
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
  window.addEventListener("popstate", handleMobileHistoryChange);
}

async function bootAuthenticatedWorkspace() {
  await loadTargets();
  state.mobileScreen = "connect";
  if (isMobileViewport()) {
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  }
  if (state.previewVisible && state.previewUrl) {
    syncPreviewFrame();
  }
  renderSocketOptions([], "");
  renderSessions();
  renderViewerMeta();
  setTargetHealth("Ready to connect", "neutral");
  restartPolling();
  scheduleMobileAutoConnect({ resetSuppression: true });
}

async function init() {
  window.__KRD_BUILD = CLIENT_BUILD;
  initializeClientDebug();
  loadUiPreferences();
  applyUiState();
  syncMobileHistory(state.mobileScreen, "replace");
  attachEvents();
  attachWheelContainment();

  const authenticated = await checkAuthStatus();
  if (authenticated) {
    await bootAuthenticatedWorkspace();
  } else {
    setAuthStatus("Enter the token for this device.", "neutral");
    elements.authTokenInput.focus();
  }
}

init().catch((error) => {
  setAuthState(false);
  setStatus(error.message, "danger");
  setAuthStatus(error.message, "danger");
  setAuthDeviceMeta(null, "Authentication status check failed. Try again later or enter the token again.");
});
