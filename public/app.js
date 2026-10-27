const STORAGE_KEY = "kitty-remote-deck-ui";
const DEBUG_STORAGE_KEY = "kitty-remote-deck-debug";
const CLIENT_BUILD = "1.0.0";
const MOBILE_HISTORY_KEY = "krdMobileScreen";
const LAST_PANE_STORAGE_KEY = "kitty-remote-deck-last-pane";
const FONT_SIZE_RANGE = { min: 5, max: 18, default: 13 };
const THEME_SET = new Set(["dark", "graphite", "nord", "mocha", "tokyo", "gruvbox", "rosepine", "cyberpunk-dark", "light", "latte", "solarized", "cyberpunk-light"]);
const TEXT_EXTENT_SET = new Set(["screen", "all"]);
const MOBILE_TERMINAL_WIDTH_SET = new Set(["fit", "wide"]);
const MOBILE_SCREEN_SET = new Set(["connect", "sessions", "layouts", "reports", "chat", "browser"]);
const SIDEBAR_WIDTH_RANGE = { min: 220, max: 520 };
// The chat composer grows with its text up to this height; 230 was the old fixed panel height.
const PANEL_HEIGHT_RANGE = { min: 80, max: 420, default: 160, legacyDefault: 230 };
// No fixed pixel cap: the drawer may take up to maxFraction of the viewport, minus the terminal minimum.
const BROWSER_WIDTH_RANGE = { min: 320, maxFraction: 0.7, default: 560 };
// Adaptive polling: refresh fast while the pane is changing or just received input,
// then back off as it goes quiet. Polling pauses while the page is hidden.
const POLL_ACTIVE_MS = 700;
const POLL_WARM_MS = 1500;
const POLL_IDLE_MS = 4000;
const POLL_ACTIVE_WINDOW_MS = 15000;
const POLL_WARM_WINDOW_MS = 60000;
const SESSION_TREE_REFRESH_MS = 15000;
const ALL_TEXT_AUTO_REFRESH_MS = 15000;
const WHEEL_SCROLL_DEBOUNCE_MS = 70;
const WHEEL_SCROLL_MAX_LINES = 80;
const TOUCH_SCROLL_LINE_PX = 42;
const TOUCH_SCROLL_SENSITIVITY = 5;
const LOCAL_SCROLL_BOUNDARY_EPSILON = 2;
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
const PANE_TREE = window.KRDPaneTree;
const TERMINAL_LINES = window.KRDTerminalLines;
const PANE_LAYOUT_STORAGE_KEY = "kitty-remote-deck.paneLayout.v1";
const SECONDARY_VIEW_POLL_MS = 2000;
// With a live tmux event stream, polling is only a safety net.
const LIVE_POLL_MS = 15000;
const LIVE_MIN_GAP_MS = { screen: 120, all: 600 };
const LIVE_RESUBSCRIBE_DEBOUNCE_MS = 150;
const LIVE_RECONNECT_MAX_MS = 60000;
const ANSI_UTILS = window.KRDAnsiUtils;

const DEFAULT_TARGET_FORM = {
  name: "Local Kitty",
  transport: "local",
  backend: "kitty",
  sshTarget: "",
  kittyBinary: "kitty",
  tmuxBinary: "tmux",
  socketPattern: "/tmp/kitty.sock-*",
  defaultSocket: "",
  notes: ""
};

// The session tree keeps kitty's shape for both backends; only the names differ.
// tmux: session -> OS window, window -> tab, pane -> pane.
const BACKEND_DEFAULTS = {
  kitty: {
    socketPattern: "/tmp/kitty.sock-*",
    socketPlaceholder: "/tmp/kitty.sock-*",
    defaultSocketPlaceholder: "/tmp/kitty.sock-11305",
    sectionTitle: "Kitty Remote Control",
    sectionHint: "kitty @",
    labels: {
      osWindow: "OS Window",
      tab: "Tab",
      window: "Pane",
      createWindow: "New Window",
      createTab: "New Tab",
      createSplit: "New Split"
    }
  },
  tmux: {
    socketPattern: "",
    socketPlaceholder: "auto: $TMUX_TMPDIR/tmux-UID/*",
    defaultSocketPlaceholder: "/tmp/tmux-1000/default",
    sectionTitle: "tmux Server",
    sectionHint: "tmux -S",
    labels: {
      osWindow: "Session",
      tab: "Window",
      window: "Pane",
      createWindow: "New Session",
      createTab: "New Window",
      createSplit: "New Split"
    }
  }
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
  sessionLabels: BACKEND_DEFAULTS.kitty.labels,
  sessionBackend: "kitty",
  selectedWindowId: null,
  screenText: "",
  autoRefresh: true,
  refreshing: false,
  activeSidebarView: "ssh",
  sidebarVisible: true,
  uiFontSizePx: FONT_SIZE_RANGE.default,
  uiTheme: "dark",
  screenExtent: "all",
  screenExtentExplicit: false,
  autoFitPane: true,
  // Browser-side view splits (see modules/pane-tree.js). The active leaf is the
  // view that the single-selection state below describes.
  paneRoot: null,
  activePaneId: null,
  // Saved layouts from the server. activeLayoutId names the one on screen;
  // null means Scratch, this device's unsaved layout. While a named layout is
  // active, scratchLayout keeps Scratch so it can be brought back, and
  // activeLayoutSaved is the serialized form last written to the server.
  layouts: [],
  activeLayoutId: null,
  activeLayoutSaved: "",
  scratchLayout: null,
  // Pages opened in the embedded Browser, listed server-side (data/reports.json).
  reports: [],
  // The target the Browser fetches through; a report can name another target
  // than the one the terminal is connected to.
  previewTargetId: "",
  allTextFollowTail: true,
  previewVisible: false,
  previewPinned: false,
  previewUrl: "",
  previewHistory: [],
  previewHistoryIndex: -1,
  previewAccessToken: "",
  previewAccessExpiresAt: "",
  mobileScreen: "connect",
  // Phone screens as a stack: the top is mobileScreen, "back" pops.
  mobileStack: ["connect"],
  mobileTerminalWidth: "fit",
  resizeEnabled: false,
  sidebarWidth: 320,
  browserWidth: BROWSER_WIDTH_RANGE.default,
  bottomPanelHeight: PANEL_HEIGHT_RANGE.default,
  // Set by dragging the panel edge: the composer then keeps that height instead of growing with its text.
  bottomPanelPinned: false,
  imageAttachment: null,
  composerSending: false,
  sessionCreating: false
};

// Every view slot owns one output element for its whole life. Activating a view
// only changes which element the selection, composer and sidebar act on; nothing
// moves in the DOM, so scroll positions and layout stay put.
const originalScreenOutput = document.querySelector("#screenOutput");
let activeOutput = originalScreenOutput;
let outputResizeObserver = null;

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
  showLayoutsViewBtn: document.querySelector("#showLayoutsViewBtn"),
  showBrowserViewBtn: document.querySelector("#showBrowserViewBtn"),
  browserSidebarView: document.querySelector("#browserSidebarView"),
  mobileBackFromBrowserListBtn: document.querySelector("#mobileBackFromBrowserListBtn"),
  mobileBrowserListBtn: document.querySelector("#mobileBrowserListBtn"),
  mobileReportsBtn: document.querySelector("#mobileReportsBtn"),
  reloadReportsBtn: document.querySelector("#reloadReportsBtn"),
  reportOpenForm: document.querySelector("#reportOpenForm"),
  reportUrlInput: document.querySelector("#reportUrlInput"),
  reportSummary: document.querySelector("#reportSummary"),
  reportList: document.querySelector("#reportList"),
  primarySidebar: document.querySelector("#primarySidebar"),
  sshSidebarView: document.querySelector("#sshSidebarView"),
  sessionsSidebarView: document.querySelector("#sessionsSidebarView"),
  layoutsSidebarView: document.querySelector("#layoutsSidebarView"),
  saveLayoutBtn: document.querySelector("#saveLayoutBtn"),
  mobileLayoutsBtn: document.querySelector("#mobileLayoutsBtn"),
  mobileBackFromLayoutsBtn: document.querySelector("#mobileBackFromLayoutsBtn"),
  reloadLayoutsBtn: document.querySelector("#reloadLayoutsBtn"),
  layoutSaveForm: document.querySelector("#layoutSaveForm"),
  layoutNameInput: document.querySelector("#layoutNameInput"),
  layoutSummary: document.querySelector("#layoutSummary"),
  layoutList: document.querySelector("#layoutList"),
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
  themeSelectMobile: document.querySelector("#themeSelectMobile"),
  decreaseFontBtnMobile: document.querySelector("#decreaseFontBtnMobile"),
  increaseFontBtnMobile: document.querySelector("#increaseFontBtnMobile"),
  fontSizeValueMobile: document.querySelector("#fontSizeValueMobile"),
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
  get screenOutput() {
    return activeOutput;
  },
  latestOutputBtn: document.querySelector("#latestOutputBtn"),
  bottomPanel: document.querySelector("#bottomPanel"),
  previewDrawer: document.querySelector("#previewDrawer"),
  browserHandleBtn: document.querySelector("#browserHandleBtn"),
  browserHandleLabel: document.querySelector("#browserHandleLabel"),
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
  urlPreviewFrame: document.querySelector("#urlPreviewFrame"),
  screenModeBtn: document.querySelector("#screenModeBtn"),
  allTextModeBtn: document.querySelector("#allTextModeBtn"),
  editorMenu: document.querySelector("#editorMenu"),
  editorMenuBtn: document.querySelector("#editorMenuBtn"),
  editorMenuPopover: document.querySelector("#editorMenuPopover"),
  autoFitToggle: document.querySelector("#autoFitToggle"),
  fitPaneBtn: document.querySelector("#fitPaneBtn"),
  zoomPaneBtn: document.querySelector("#zoomPaneBtn"),
  paneTree: document.querySelector("#paneTree"),
  splitRightBtn: document.querySelector("#splitRightBtn"),
  splitDownBtn: document.querySelector("#splitDownBtn"),
  sendRawTextBtn: document.querySelector("#sendRawTextBtn"),
  sendTextBtn: document.querySelector("#sendTextBtn"),
  specialKeyMenu: document.querySelector("#specialKeyMenu"),
  specialKeyMenuBtn: document.querySelector("#specialKeyMenuBtn"),
  specialKeyMenuPopover: document.querySelector("#specialKeyMenuPopover"),
  sendForm: document.querySelector("#sendForm"),
  sendTextInput: document.querySelector("#sendTextInput"),
  composerStack: document.querySelector("#composerStack"),
  attachImageBtn: document.querySelector("#attachImageBtn"),
  imageInput: document.querySelector("#imageInput"),
  imageAttachment: document.querySelector("#imageAttachment"),
  imageAttachmentThumb: document.querySelector("#imageAttachmentThumb"),
  imageAttachmentName: document.querySelector("#imageAttachmentName"),
  imageAttachmentInfo: document.querySelector("#imageAttachmentInfo"),
  removeImageBtn: document.querySelector("#removeImageBtn"),
  statusTargetName: document.querySelector("#statusTargetName"),
  statusSocketName: document.querySelector("#statusSocketName"),
  statusMessage: document.querySelector("#statusMessage"),
  statusPaneName: document.querySelector("#statusPaneName"),
  statusAutoRefresh: document.querySelector("#statusAutoRefresh"),
  targetName: document.querySelector("#targetName"),
  targetSsh: document.querySelector("#targetSsh"),
  targetBackend: document.querySelector("#targetBackend"),
  targetBackendSectionTitle: document.querySelector("#targetBackendSectionTitle"),
  targetBackendSectionHint: document.querySelector("#targetBackendSectionHint"),
  targetKittyBinary: document.querySelector("#targetKittyBinary"),
  targetKittyBinaryField: document.querySelector("#targetKittyBinaryField"),
  targetTmuxBinary: document.querySelector("#targetTmuxBinary"),
  targetTmuxBinaryField: document.querySelector("#targetTmuxBinaryField"),
  targetSocketPattern: document.querySelector("#targetSocketPattern"),
  targetDefaultSocket: document.querySelector("#targetDefaultSocket"),
  targetNotes: document.querySelector("#targetNotes")
};

let pollTimer = null;
let resizeSession = null;
let pendingScrollLines = 0;
let scrollFlushTimer = null;
let remoteScrollInFlight = false;
let screenTouchScroll = null;
let screenRequestSerial = 0;
let screenAbortController = null;
let sessionRequestSerial = 0;
let pollGeneration = 0;
let pollInFlight = false;
// True after Screen-mode scrolling moves the kitty viewport into history.
let viewportScrolledBack = false;
let lastScreenActivityAt = 0;
let lastTreeRefreshAt = 0;
let lastAllTextRefreshAt = 0;
// Hash of the screen currently rendered, so polls can ask the server for "unchanged".
let renderedScreen = { key: "", hash: "", text: null, data: null };
// Recently shown panes, keyed like renderedScreen: switching back repaints the
// last snapshot at once and asks the server only for what changed since.
const SCREEN_CACHE_LIMIT = 8;
const screenCache = new Map();

function screenKeyFor(targetId, socket, windowId, extent) {
  return `${targetId}|${socket || ""}|${windowId}|${extent}`;
}

function rememberScreen(entry) {
  if (!entry.key || typeof entry.text !== "string" || !entry.data) {
    return;
  }
  const isNew = !screenCache.has(entry.key);
  screenCache.delete(entry.key);
  screenCache.set(entry.key, entry);
  while (screenCache.size > SCREEN_CACHE_LIMIT) {
    screenCache.delete(screenCache.keys().next().value);
  }
  if (isNew && state.flatWindows.length) {
    renderSessions();
  }
}

function isPaneCached(windowId) {
  return ["all", "screen"].some((extent) => screenCache.has(screenKeyFor(state.selectedTargetId, state.selectedSocket, Number(windowId), extent)));
}

// Before leaving a pane, keep its snapshot plus where the user had scrolled.
function stashRenderedScreen() {
  if (!renderedScreen.key || elements.screenOutput.getAttribute("aria-busy") === "true" || renderedScreen.text !== state.screenText) {
    return;
  }
  rememberScreen({
    ...renderedScreen,
    scrollTop: elements.screenOutput.scrollTop,
    followTail: state.allTextFollowTail
  });
}

// Repaint a cached snapshot for the pane being selected; false when none.
function restoreCachedScreen(windowId) {
  const key = screenKeyFor(state.selectedTargetId, state.selectedSocket, windowId, activeExtent());
  const entry = screenCache.get(key);
  if (!entry) {
    return false;
  }
  renderedScreen = { key: entry.key, hash: entry.hash, text: entry.text, data: entry.data };
  if (activeExtent() === "all") {
    state.allTextFollowTail = entry.followTail !== false;
  }
  renderScreenData(entry.data, { scrollToBottom: activeExtent() === "all" && state.allTextFollowTail });
  if (!(activeExtent() === "all" && state.allTextFollowTail)) {
    elements.screenOutput.scrollTop = entry.scrollTop || 0;
  }
  return true;
}
// Pane id -> text last drawn into the tmux window layout (see renderWindowLayout).
function paneTextsFor(output) {
  if (!output.__paneTexts) {
    output.__paneTexts = new Map();
  }
  return output.__paneTexts;
}
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

function selectedPane() {
  return state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId)) || null;
}

// Alternate-screen apps (Claude Code fullscreen, vim) keep no scrollback, so the
// All view would only show stale shell history. Such panes always use the
// viewport semantics, and scroll gestures become the app's PgUp/PgDn keys.
function activeExtent() {
  return selectedPane()?.alternate_on ? "screen" : state.screenExtent;
}

// tmux pane ids start at %0, so the selection must not be tested for truthiness.
function hasSelectedWindow() {
  return state.selectedWindowId !== null && state.selectedWindowId !== undefined && state.selectedWindowId !== "";
}

function normalizeBackend(value) {
  return value === "tmux" ? "tmux" : "kitty";
}

function getBackendDefaults(backend) {
  return BACKEND_DEFAULTS[normalizeBackend(backend)];
}

function labelsForTarget(target) {
  return getBackendDefaults(target?.backend).labels;
}

function describePaneLocation(pane) {
  const labels = state.sessionLabels;
  const osWindowName = pane.osWindowTitle || `#${pane.osWindowId}`;
  const tabName = pane.osWindowTitle ? pane.tabTitle || `#${pane.tabId}` : `#${pane.tabId}`;
  return `${labels.osWindow} ${osWindowName} / ${labels.tab} ${tabName} / #${pane.id}`;
}

function getEditingTarget() {
  return state.targets.find((target) => target.id === state.editingTargetId) || null;
}

function captureSelectedPane() {
  return {
    targetId: state.selectedTargetId,
    socket: state.selectedSocket,
    windowId: state.selectedWindowId
  };
}

function isPaneStillSelected(pane) {
  return (
    pane.targetId === state.selectedTargetId &&
    pane.socket === state.selectedSocket &&
    Number(pane.windowId) === Number(state.selectedWindowId)
  );
}

function invalidateScreenRequests() {
  screenRequestSerial += 1;
  if (screenAbortController) {
    screenAbortController.abort();
    screenAbortController = null;
  }
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
      browserHandle: describeBox(elements.browserHandleBtn)
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
  const minEditorWidth = viewportWidth <= 720 ? 96 : 180;
  const maxByLayout = viewportWidth - activityWidth - sidebarWidth - minEditorWidth;

  if (viewportWidth <= 720) {
    const min = Math.min(260, Math.max(220, maxByLayout));
    return { min, max: Math.max(min, maxByLayout) };
  }

  const min = Math.min(BROWSER_WIDTH_RANGE.min, Math.max(260, maxByLayout));
  const maxByFraction = Math.round(viewportWidth * BROWSER_WIDTH_RANGE.maxFraction);
  const max = Math.max(min, Math.min(maxByFraction, maxByLayout));
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

const SIDEBAR_VIEW_SET = new Set(["ssh", "sessions", "layouts", "browser"]);

function loadUiPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    state.autoFitPane = parsed.autoFitPane !== false;
    state.uiFontSizePx = normalizeFontSizePx(parsed.uiFontSizePx ?? parsed.uiFontSize);
    state.uiTheme = THEME_SET.has(parsed.uiTheme) ? parsed.uiTheme : "dark";
    // All is the default; a stored Screen choice only sticks if the user picked it from the menu.
    state.screenExtentExplicit = parsed.screenExtentExplicit === true;
    state.screenExtent =
      state.screenExtentExplicit && TEXT_EXTENT_SET.has(parsed.screenExtent) ? parsed.screenExtent : "all";
    state.mobileTerminalWidth = MOBILE_TERMINAL_WIDTH_SET.has(parsed.mobileTerminalWidth)
      ? parsed.mobileTerminalWidth
      : "fit";
    state.resizeEnabled = Boolean(parsed.resizeEnabled);
    state.activeSidebarView = SIDEBAR_VIEW_SET.has(parsed.activeSidebarView)
      ? parsed.activeSidebarView
      : "ssh";
    state.previewVisible = Boolean(parsed.previewVisible);
    state.previewPinned = Boolean(parsed.previewPinned);
    state.previewUrl = typeof parsed.previewUrl === "string" ? parsed.previewUrl : "";
    state.previewTargetId = typeof parsed.previewTargetId === "string" ? parsed.previewTargetId : "";
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
      ? Math.max(BROWSER_WIDTH_RANGE.min, Math.round(parsed.browserWidth))
      : BROWSER_WIDTH_RANGE.default;
    // A stored value equal to the old default was never chosen by the user; take the new one.
    state.bottomPanelHeight =
      Number.isFinite(parsed.bottomPanelHeight) && parsed.bottomPanelHeight !== PANEL_HEIGHT_RANGE.legacyDefault
        ? clamp(parsed.bottomPanelHeight, PANEL_HEIGHT_RANGE.min, PANEL_HEIGHT_RANGE.max)
        : PANEL_HEIGHT_RANGE.default;
    state.bottomPanelPinned = Boolean(parsed.bottomPanelPinned);
  } catch (error) {
    state.autoRefresh = true;
    state.autoFitPane = true;
    state.uiFontSizePx = FONT_SIZE_RANGE.default;
    state.uiTheme = "dark";
    state.screenExtent = "all";
    state.screenExtentExplicit = false;
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
    state.bottomPanelHeight = PANEL_HEIGHT_RANGE.default;
    state.bottomPanelPinned = false;
  }
}

// The last selected pane is restored after a reload when the same target and socket
// still list it. kitty window ids are not reused within one kitty instance, and the
// socket path names that instance.
function rememberSelectedPane() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }
  syncActivePaneActor();
  syncLiveSubscriptions();
  try {
    localStorage.setItem(
      LAST_PANE_STORAGE_KEY,
      JSON.stringify({
        targetId: state.selectedTargetId,
        socket: state.selectedSocket,
        windowId: Number(state.selectedWindowId)
      })
    );
  } catch (error) {
    // Storage can be unavailable (private mode); restoration is a convenience only.
  }
}

function findRestorablePane(targetId) {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(LAST_PANE_STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
  if (!saved || saved.targetId !== targetId || saved.socket !== state.selectedSocket) {
    return null;
  }
  const windowId = Number(saved.windowId);
  return state.flatWindows.some((window) => Number(window.id) === windowId) ? windowId : null;
}

function saveUiPreferences() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      autoRefresh: state.autoRefresh,
      autoFitPane: state.autoFitPane,
      uiFontSizePx: state.uiFontSizePx,
      uiTheme: state.uiTheme,
      screenExtent: state.screenExtent,
      screenExtentExplicit: state.screenExtentExplicit === true,
      mobileTerminalWidth: state.mobileTerminalWidth,
      previewVisible: state.previewVisible,
      previewPinned: state.previewPinned,
      previewUrl: state.previewUrl,
      previewTargetId: state.previewTargetId,
      previewHistory: state.previewHistory,
      previewHistoryIndex: state.previewHistoryIndex,
      resizeEnabled: state.resizeEnabled,
      activeSidebarView: state.activeSidebarView,
      sidebarVisible: state.sidebarVisible,
      sidebarWidth: state.sidebarWidth,
      browserWidth: state.browserWidth,
      bottomPanelHeight: state.bottomPanelHeight,
      bottomPanelPinned: state.bottomPanelPinned
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

const MOBILE_NAV_NONCE = Math.random().toString(36).slice(2);
const MOBILE_SCREEN_TITLES = {
  connect: "Connect",
  sessions: "Sessions",
  layouts: "Layouts",
  reports: "Reports",
  chat: "Terminal",
  browser: "Browser"
};

function mobileHistoryEntry(index) {
  return { [MOBILE_HISTORY_KEY]: state.mobileStack[index], krdIndex: index, krdNonce: MOBILE_NAV_NONCE };
}

// Shows a screen without touching the stack or the browser history.
function applyMobileScreen(screen) {
  const nextScreen = MOBILE_SCREEN_SET.has(screen) ? screen : "connect";
  state.mobileScreen = nextScreen;

  if (isMobileViewport()) {
    if (nextScreen === "browser") {
      state.previewVisible = Boolean(state.previewUrl);
    } else {
      state.previewVisible = false;
      state.previewPinned = false;
    }
    if (nextScreen === "connect") {
      cancelMobileAutoConnect({ suppress: true });
    }
  }

  if (nextScreen === "connect") {
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  } else if (nextScreen === "sessions") {
    state.activeSidebarView = "sessions";
    state.sidebarVisible = true;
  } else if (nextScreen === "layouts") {
    state.activeSidebarView = "layouts";
    state.sidebarVisible = true;
  } else if (nextScreen === "reports") {
    state.activeSidebarView = "browser";
    state.sidebarVisible = true;
  } else {
    state.sidebarVisible = false;
  }

  applyUiState();
  if (nextScreen === "browser") {
    syncPreviewFrame();
  }
  if (nextScreen === "chat") {
    refreshPaneAfterMobileReturn();
  }
  sendClientDebug(`setMobileScreen:${nextScreen}`, null, { force: true });
}

// Forward navigation: pushes the screen (or unwinds to it when it is already
// on the stack) and mirrors the stack into the browser history, so a swipe
// back and the in-page back buttons agree. history: "replace" swaps the top,
// false shows the screen without recording it.
function setMobileScreen(screen, options = {}) {
  const nextScreen = MOBILE_SCREEN_SET.has(screen) ? screen : "connect";
  if (isMobileViewport() && options.history !== false) {
    const before = state.mobileStack;
    const after = options.history === "replace"
      ? MOBILE_UTILS.replaceTop(before, nextScreen)
      : MOBILE_UTILS.pushScreen(before, nextScreen);
    state.mobileStack = after;
    const top = after.length - 1;
    if (after.length > before.length) {
      history.pushState(mobileHistoryEntry(top), "", window.location.href);
    } else if (after.length === before.length) {
      history.replaceState(mobileHistoryEntry(top), "", window.location.href);
    } else {
      // Unwinding: the entries above are ours, so the history can follow.
      history.go(after.length - before.length);
    }
  }
  applyMobileScreen(nextScreen);
}

// Makes the current history entry the base of a fresh stack.
function resetMobileStack(screen) {
  state.mobileStack = [MOBILE_SCREEN_SET.has(screen) ? screen : "connect"];
  if (isMobileViewport()) {
    history.replaceState(mobileHistoryEntry(0), "", window.location.href);
  }
}

// Every back button pops one screen. The history follows so that a later
// swipe back continues from the same place.
function handleMobileBack() {
  if (!isMobileViewport() || state.mobileStack.length <= 1) {
    applyMobileScreen(state.mobileStack[0]);
    return;
  }
  state.mobileStack = MOBILE_UTILS.popScreen(state.mobileStack);
  applyMobileScreen(state.mobileStack[state.mobileStack.length - 1]);
  history.back();
}

function refreshPaneAfterMobileReturn() {
  if (
    !isMobileViewport() ||
    state.mobileScreen !== "chat" ||
    !state.selectedTargetId ||
    !hasSelectedWindow()
  ) {
    return;
  }

  refreshScreen({
    force: true,
    scrollToBottom: activeExtent() === "all" && state.allTextFollowTail
  }).catch((error) => setStatus(error.message, "danger"));
}

// Swipe back/forward and the hardware back key land here.
function handleMobileHistoryChange(event) {
  if (!isMobileViewport()) {
    return;
  }
  const result = MOBILE_UTILS.stackForHistoryEntry({
    stack: state.mobileStack,
    entry: event.state,
    key: MOBILE_HISTORY_KEY,
    nonce: MOBILE_NAV_NONCE,
    allowedScreens: MOBILE_SCREEN_SET
  });
  state.mobileStack = result.stack;
  if (result.foreign) {
    history.replaceState(mobileHistoryEntry(0), "", window.location.href);
  }
  if (result.screen !== state.mobileScreen) {
    applyMobileScreen(result.screen);
  } else {
    applyUiState();
  }
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

function applyUiState() {
  if (isMobileViewport()) {
    state.sidebarVisible = state.mobileScreen !== "chat";
    if (state.mobileScreen === "connect") {
      state.activeSidebarView = "ssh";
    } else if (state.mobileScreen === "sessions") {
      state.activeSidebarView = "sessions";
    } else if (state.mobileScreen === "layouts") {
      state.activeSidebarView = "layouts";
    } else if (state.mobileScreen === "reports") {
      state.activeSidebarView = "browser";
    }
  }

  const showingSsh = state.activeSidebarView === "ssh";
  const showingSessions = state.activeSidebarView === "sessions";
  const showingLayouts = state.activeSidebarView === "layouts";
  const showingBrowser = state.activeSidebarView === "browser";
  elements.sshSidebarView.hidden = !showingSsh;
  elements.sessionsSidebarView.hidden = !showingSessions;
  elements.layoutsSidebarView.hidden = !showingLayouts;
  elements.browserSidebarView.hidden = !showingBrowser;
  elements.appShell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
  elements.appShell.classList.toggle("preview-open", state.previewVisible);
  elements.appShell.classList.toggle("browser-pinned", state.previewVisible && state.previewPinned);
  elements.appShell.classList.toggle("mobile-screen-connect", state.mobileScreen === "connect");
  elements.appShell.classList.toggle("mobile-screen-sessions", state.mobileScreen === "sessions");
  elements.appShell.classList.toggle("mobile-screen-layouts", state.mobileScreen === "layouts");
  elements.appShell.classList.toggle("mobile-screen-reports", state.mobileScreen === "reports");
  elements.appShell.classList.toggle("mobile-screen-chat", state.mobileScreen === "chat");
  elements.appShell.classList.toggle("mobile-screen-browser", state.mobileScreen === "browser");
  elements.appShell.classList.toggle("mobile-terminal-wide", state.mobileTerminalWidth === "wide");
  elements.showSshViewBtn.classList.toggle("active", state.sidebarVisible && showingSsh);
  elements.showSessionsViewBtn.classList.toggle("active", state.sidebarVisible && showingSessions);
  elements.showSshViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSsh));
  elements.showSessionsViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSessions));
  elements.showLayoutsViewBtn.classList.toggle("active", state.sidebarVisible && showingLayouts);
  elements.showLayoutsViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingLayouts));
  elements.showBrowserViewBtn.classList.toggle("active", state.sidebarVisible && showingBrowser);
  elements.showBrowserViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingBrowser));
  elements.appShell.classList.toggle("resize-enabled", state.resizeEnabled);
  elements.previewDrawer.setAttribute("aria-hidden", String(!state.previewVisible));
  applyBrowserHandle();
  applyMobileBackLabels();
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
  elements.autoFitToggle.checked = state.autoFitPane;
  elements.fontSizeValue.textContent = `${state.uiFontSizePx}px`;
  elements.themeSelect.value = state.uiTheme;
  if (elements.fontSizeValueMobile) {
    elements.fontSizeValueMobile.textContent = `${state.uiFontSizePx}px`;
  }
  if (elements.themeSelectMobile) {
    if (!elements.themeSelectMobile.options.length) {
      elements.themeSelectMobile.innerHTML = elements.themeSelect.innerHTML;
    }
    elements.themeSelectMobile.value = state.uiTheme;
  }
  elements.screenModeBtn.classList.toggle("active", state.screenExtent === "screen");
  elements.allTextModeBtn.classList.toggle("active", state.screenExtent === "all");
  elements.screenModeBtn.setAttribute("aria-pressed", String(state.screenExtent === "screen"));
  elements.allTextModeBtn.setAttribute("aria-pressed", String(state.screenExtent === "all"));
  elements.screenOutput.dataset.extent = activeExtent();
  elements.mobileTerminalWidthBtn.classList.toggle("active", state.mobileTerminalWidth === "wide");
  elements.mobileTerminalWidthBtn.setAttribute("aria-pressed", String(state.mobileTerminalWidth === "wide"));
  elements.mobileTerminalWidthBtn.textContent = state.mobileTerminalWidth === "wide" ? "Wide" : "Fit";
  elements.mobileTerminalWidthBtn.title = state.mobileTerminalWidth === "wide"
    ? "Keep the terminal's original width and allow horizontal scrolling"
    : "Fit terminal text to the phone width";
  elements.resizeToggle.setAttribute("aria-pressed", String(state.resizeEnabled));
  document.documentElement.style.setProperty("--root-font-size", `${state.uiFontSizePx}px`);
  document.documentElement.dataset.theme = state.uiTheme;
  document.documentElement.style.setProperty("--sidebar-width", `${getEffectiveSidebarWidth()}px`);
  document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
  document.documentElement.style.setProperty("--bottom-panel-height", `${state.bottomPanelHeight}px`);
  autosizeComposer();
  applyResizeLabel();
  updateStatusBar();
  saveUiPreferences();
  // Pinning, unpinning or navigating the Browser changes the active layout.
  scheduleLayoutAutosave();
}

// Each phone screen's back button names the screen underneath it.
const MOBILE_BACK_BUTTONS = {
  sessions: "mobileBackToConnectBtn",
  chat: "mobileBackToSessionsBtn",
  layouts: "mobileBackFromLayoutsBtn",
  reports: "mobileBackFromBrowserListBtn",
  browser: "mobileBrowserBackBtn"
};

function applyMobileBackLabels() {
  if (!isMobileViewport()) {
    return;
  }
  const stack = state.mobileStack;
  const below = stack.length > 1 ? stack[stack.length - 2] : null;
  Object.entries(MOBILE_BACK_BUTTONS).forEach(([screen, id]) => {
    const button = elements[id];
    if (!button) {
      return;
    }
    if (screen === state.mobileScreen) {
      button.textContent = `‹ ${MOBILE_SCREEN_TITLES[below] || "Back"}`;
    }
  });
}

// The right-edge tab shows while a Browser page exists but the drawer is
// hidden; on a phone only on the terminal screen.
function applyBrowserHandle() {
  const visible = Boolean(state.previewUrl) && !state.previewVisible && (!isMobileViewport() || state.mobileScreen === "chat");
  elements.browserHandleBtn.hidden = !visible;
  if (!visible) {
    return;
  }
  const label = browserHandleLabel();
  elements.browserHandleLabel.textContent = label;
  elements.browserHandleBtn.title = label;
  elements.browserHandleBtn.setAttribute("aria-label", `Open Browser: ${label}`);
}

function browserHandleLabel() {
  const report = state.reports.find((item) => item.url === state.previewUrl && (!state.previewTargetId || item.targetId === state.previewTargetId));
  return reportLabel(report || { url: state.previewUrl });
}

// Tap or a leftward swipe opens the Browser; the tab follows the finger first.
let browserHandleGesture = null;

function resetBrowserHandleGesture() {
  browserHandleGesture = null;
  elements.browserHandleBtn.classList.remove("dragging");
  elements.browserHandleBtn.style.transform = "";
}

function attachBrowserHandle() {
  const button = elements.browserHandleBtn;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    browserHandleGesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    button.classList.add("dragging");
    try {
      button.setPointerCapture(event.pointerId);
    } catch (error) {
      // No capture: the swipe still works while the pointer stays on the tab.
    }
  });
  button.addEventListener("pointermove", (event) => {
    if (!browserHandleGesture || event.pointerId !== browserHandleGesture.id) {
      return;
    }
    const dx = clamp(event.clientX - browserHandleGesture.startX, -56, 0);
    if (dx < -8) {
      browserHandleGesture.moved = true;
    }
    button.style.transform = `translate(${dx}px, -50%)`;
  });
  button.addEventListener("pointerup", (event) => {
    if (!browserHandleGesture || event.pointerId !== browserHandleGesture.id) {
      return;
    }
    const dx = event.clientX - browserHandleGesture.startX;
    const dy = Math.abs(event.clientY - browserHandleGesture.startY);
    const tap = !browserHandleGesture.moved && dy < 16;
    resetBrowserHandleGesture();
    if (tap || dx <= -24) {
      reopenPreview().catch((error) => setStatus(error.message, "danger"));
    }
  });
  button.addEventListener("pointercancel", resetBrowserHandleGesture);
  // Keyboard activation arrives as a click without pointer events.
  button.addEventListener("click", (event) => {
    if (event.detail === 0) {
      reopenPreview().catch((error) => setStatus(error.message, "danger"));
    }
  });
}

function applyResizeLabel() {
  elements.resizeLabel.textContent = state.resizeEnabled ? "Unlocked" : "Locked";
  elements.resizeToggle.title = state.resizeEnabled
    ? "Layout unlocked. Drag the sidebar and bottom panel edges; click to lock."
    : "Layout locked. Click to allow dragging the sidebar and bottom panel edges.";
}

function stepFontSize(delta) {
  state.uiFontSizePx = clamp(state.uiFontSizePx + delta, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
  applyUiState();
  // Cell size changed: redraw the layout at the new size now, then refit the pane.
  syncLayoutCellSize();
  scheduleAutoFit();
}

function syncLayoutCellSize() {
  const container = elements.screenOutput.querySelector(".tmux-window");
  if (!container) {
    return;
  }
  const cell = measureCellSize(elements.screenOutput);
  container.style.setProperty("--cell-w", `${cell.width}px`);
  container.style.setProperty("--cell-h", `${cell.height}px`);
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
  return BROWSER_UTILS.createPreviewResourceUrl(url, targetId, state.previewAccessToken);
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

// The target the Browser reads through: the report's own target when one was
// opened from the list, otherwise the connected target.
function getPreviewTarget() {
  return state.targets.find((target) => target.id === state.previewTargetId) || getSelectedTarget();
}

async function refreshPreviewAccessToken() {
  const target = getPreviewTarget();
  if (!target || !state.previewUrl) {
    state.previewAccessToken = "";
    state.previewAccessExpiresAt = "";
    return false;
  }
  state.previewTargetId = target.id;

  const params = new URLSearchParams({
    targetId: target.id,
    url: state.previewUrl
  });
  const data = await apiFetch(`/api/url-access-token?${params.toString()}`);
  state.previewAccessToken = data.accessToken || "";
  state.previewAccessExpiresAt = data.expiresAt || "";
  return Boolean(state.previewAccessToken);
}

function syncPreviewFrame() {
  const target = getPreviewTarget();
  if (!target || !state.previewUrl) {
    return false;
  }

  const nextSrc = createPreviewResourceUrl(state.previewUrl, target.id);
  elements.previewTitle.textContent = target.name ? `${target.name} Browser` : "Browser";
  elements.previewAddress.textContent = state.previewUrl;
  if (elements.urlPreviewFrame.dataset.src !== nextSrc) {
    elements.urlPreviewFrame.dataset.src = nextSrc;
    // location.replace keeps the frame out of the browser's history, so a
    // swipe back on the phone pops a deck screen instead of a frame page.
    try {
      elements.urlPreviewFrame.contentWindow.location.replace(nextSrc);
    } catch (error) {
      elements.urlPreviewFrame.src = nextSrc;
    }
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
  if (!state.authenticated) {
    closeLiveSource();
  }
  state.authDevice = state.authenticated ? device : null;
  elements.authGate.hidden = state.authenticated;
  elements.authDeviceLabel.hidden = !state.authenticated;
  elements.logoutBtn.hidden = !state.authenticated;
  elements.authDeviceLabel.textContent = state.authDevice ? `Key: ${getAuthDeviceText(state.authDevice)}` : "";
  setAuthDeviceMeta(state.authDevice);

  if (!state.authenticated) {
    stopPolling();
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
  elements.statusPaneName.textContent = pane ? `Pane: ${describePaneLocation(pane)}` : "Pane: -";
  elements.statusAutoRefresh.textContent = `Updates: ${isPrimaryLive() ? "live" : "polling"}`;
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

function getScreenOutputScrollBoundary() {
  const output = elements.screenOutput;
  const maxScrollTop = Math.max(0, output.scrollHeight - output.clientHeight);
  return {
    maxScrollTop,
    atTop: output.scrollTop <= LOCAL_SCROLL_BOUNDARY_EPSILON,
    atBottom: output.scrollTop >= maxScrollTop - LOCAL_SCROLL_BOUNDARY_EPSILON
  };
}

function shouldForwardScrollDeltaToKitty(deltaY) {
  if (!deltaY) {
    return false;
  }

  const boundary = getScreenOutputScrollBoundary();
  if (boundary.maxScrollTop <= LOCAL_SCROLL_BOUNDARY_EPSILON) {
    return true;
  }

  return deltaY < 0 ? boundary.atTop : boundary.atBottom;
}

function shouldForwardWheelToKitty(event) {
  return shouldForwardScrollDeltaToKitty(event.deltaY || 0);
}

function renderScreenData(data, options = {}) {
  if (data && Array.isArray(data.panes) && data.window) {
    renderWindowLayout(data, options);
  } else {
    renderScreenText(data?.text || "", options);
  }
}

function leaveWindowLayout() {
  const output = elements.screenOutput;
  const wasLayout = output.classList.contains("window-layout");
  output.classList.remove("window-layout");
  delete output.dataset.layoutKey;
  paneTextsFor(output).clear();
  return wasLayout;
}

// Draw every pane of the selected pane's tmux window where tmux puts it, so the
// view matches an attached terminal: splits, borders, zoom. Clicking a pane
// makes it the input target without leaving the window.
function renderWindowLayout(data, options = {}) {
  const output = elements.screenOutput;
  const previousTop = output.scrollTop;
  const previousLeft = output.scrollLeft;
  state.screenText = drawWindowLayout(output, data, Number(state.selectedWindowId), paneTextsFor(output));
  noteWindowSize(state.selectedWindowId, Number(data.window.columns), Number(data.window.rows));
  output.setAttribute("aria-busy", "false");
  output.dataset.paneId = hasSelectedWindow() ? String(state.selectedWindowId) : "";
  if (options.scrollToTop) {
    output.scrollTop = 0;
  } else {
    output.scrollTop = previousTop;
    output.scrollLeft = previousLeft;
  }
  updateLatestOutputButton();
}

// Draw a tmux window into any output element; returns the selected pane's text.
function drawWindowLayout(output, data, selectedId, paneTexts) {
  const selected =
    data.panes.find((pane) => Number(pane.id) === selectedId) || data.panes.find((pane) => pane.active) || data.panes[0];

  const layoutKey = [
    `${data.window.columns}x${data.window.rows}`,
    ...data.panes.map((pane) => `${pane.id}:${pane.left},${pane.top},${pane.columns},${pane.rows}`)
  ].join("|");
  let container = output.querySelector(".tmux-window");
  if (!container || output.dataset.layoutKey !== layoutKey || output.getAttribute("aria-busy") === "true") {
    output.innerHTML = "";
    paneTexts.clear();
    container = document.createElement("div");
    container.className = "tmux-window";
    data.panes.forEach((pane) => {
      const node = document.createElement("pre");
      node.className = "tmux-pane";
      node.dataset.layoutPaneId = String(pane.id);
      node.style.left = `calc(${pane.left} * var(--cell-w))`;
      node.style.top = `calc(${pane.top} * var(--cell-h))`;
      node.style.width = `calc(${pane.columns} * var(--cell-w))`;
      node.style.height = `calc(${pane.rows} * var(--cell-h))`;
      container.appendChild(node);
    });
    output.appendChild(container);
    output.dataset.layoutKey = layoutKey;
  }
  output.classList.add("window-layout");
  const cell = measureCellSize(output);
  container.style.setProperty("--cell-w", `${cell.width}px`);
  container.style.setProperty("--cell-h", `${cell.height}px`);
  container.style.width = `calc(${data.window.columns} * var(--cell-w))`;
  container.style.height = `calc(${data.window.rows} * var(--cell-h))`;

  data.panes.forEach((pane) => {
    const node = container.querySelector(`[data-layout-pane-id="${pane.id}"]`);
    if (!node) {
      return;
    }
    const text = pane.text || "";
    if (paneTexts.get(Number(pane.id)) !== text) {
      renderTerminalLines(node, text, " ");
      paneTexts.set(Number(pane.id), text);
    }
    node.classList.toggle("selected", Number(pane.id) === selectedId);
    node.classList.toggle("active", Boolean(pane.active));
    node.title = `${pane.title || `Pane ${pane.id}`} · #${pane.id} · ${pane.columns}×${pane.rows}`;
  });
  return selected ? selected.text || "" : "";
}

// After a remote scroll only the selected pane's text changes; keep the layout.
function renderScrolledPaneText(text, options = {}) {
  const node = elements.screenOutput.querySelector(`.tmux-pane[data-layout-pane-id="${state.selectedWindowId}"]`);
  if (!node || !elements.screenOutput.classList.contains("window-layout")) {
    renderScreenText(text, options);
    return;
  }
  const nextText = text || "";
  state.screenText = nextText;
  renderTerminalLines(node, nextText, " ");
  paneTextsFor(elements.screenOutput).set(Number(state.selectedWindowId), nextText);
  const cached = renderedScreen.data?.panes?.find((pane) => Number(pane.id) === Number(state.selectedWindowId));
  if (cached) {
    cached.text = nextText;
  }
  renderedScreen.text = nextText;
  updateLatestOutputButton();
}

function renderScreenText(text, options = {}) {
  const output = elements.screenOutput;
  const previousTop = output.scrollTop;
  const wasNearBottom = isScreenOutputNearBottom();
  const nextText = text || "";
  const wasLayout = leaveWindowLayout();

  if (wasLayout || state.screenText !== nextText || output.getAttribute("aria-busy") === "true") {
    state.screenText = nextText;
    renderTerminalLines(output, state.screenText, "(current screen is empty)");
  }
  output.setAttribute("aria-busy", "false");
  output.dataset.paneId = hasSelectedWindow() ? String(state.selectedWindowId) : "";

  if (activeExtent() === "all") {
    if (options.scrollToBottom || state.allTextFollowTail || wasNearBottom) {
      output.scrollTop = output.scrollHeight;
      state.allTextFollowTail = true;
    } else {
      output.scrollTop = previousTop;
    }
    updateLatestOutputButton();
    return;
  }

  if (options.scrollToTop) {
    output.scrollTop = 0;
  } else if (options.scrollToBottom) {
    output.scrollTop = output.scrollHeight;
  } else {
    setScreenOutputScrollTop(previousTop);
  }
  updateLatestOutputButton();
}

function updateLatestOutputButton() {
  const awayFromLatest =
    activeExtent() === "all" ? !state.allTextFollowTail : viewportScrolledBack;
  const hidden = !hasSelectedWindow() || !awayFromLatest;
  if (elements.latestOutputBtn.hidden !== hidden) {
    elements.latestOutputBtn.hidden = hidden;
  }
}

// Return to the live end: Screen mode scrolls the kitty viewport back to its end;
// All mode resumes tailing the browser-side scrollback.
async function jumpToLatestOutput() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }

  pendingScrollLines = 0;
  if (activeExtent() === "all") {
    state.allTextFollowTail = true;
    updateLatestOutputButton();
    await refreshScreen({ force: true, scrollToBottom: true });
    return;
  }

  await scrollRemoteWindow(0, { toEnd: true });
}

function renderPaneLoading(windowId) {
  state.screenText = "";
  leaveWindowLayout();
  elements.screenOutput.textContent = `Loading pane #${windowId}...`;
  elements.screenOutput.setAttribute("aria-busy", "true");
  elements.screenOutput.dataset.paneId = String(windowId ?? "");
  elements.screenOutput.scrollTop = 0;
}

// Scroll events arrive per frame while swiping; the bookkeeping runs once per
// animation frame and touches the DOM only when something changes.
let screenScrollFrame = 0;
function handleScreenOutputScroll() {
  if (activeExtent() !== "all" || screenScrollFrame) {
    return;
  }
  screenScrollFrame = requestAnimationFrame(() => {
    screenScrollFrame = 0;
    trackTranscriptScroll();
  });
}

function trackTranscriptScroll() {
  const wasFollowing = state.allTextFollowTail;
  state.allTextFollowTail = isScreenOutputNearBottom();
  updateLatestOutputButton();

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

function renderSpecialKeyMenu() {
  elements.specialKeyMenuPopover.innerHTML = "";

  COMPOSER_UTILS.SPECIAL_KEY_GROUPS.forEach((group) => {
    const groupNode = document.createElement("section");
    groupNode.className = "special-key-group";

    const label = document.createElement("p");
    label.className = "special-key-group-label";
    label.textContent = group.label;
    groupNode.appendChild(label);

    const grid = document.createElement("div");
    grid.className = "special-key-grid";

    group.keys.forEach((item) => {
      const button = document.createElement("button");
      button.className = "special-key-item";
      button.type = "button";
      button.role = "menuitem";
      button.dataset.specialKeyId = item.id;
      const keyLabel = document.createElement("span");
      keyLabel.className = "special-key-label";
      keyLabel.textContent = item.label;
      button.appendChild(keyLabel);
      if (item.hint) {
        const hint = document.createElement("small");
        hint.className = "special-key-hint";
        hint.textContent = item.hint;
        button.appendChild(hint);
      }
      const sent = item.keys ? item.keys.join(" ") : `${item.key}${item.repeat > 1 ? ` ×${item.repeat}` : ""}`;
      button.title = item.hint ? `${item.hint} (${sent})` : sent;
      grid.appendChild(button);
    });

    groupNode.appendChild(grid);
    elements.specialKeyMenuPopover.appendChild(groupNode);
  });
}

function closeEditorMenu() {
  elements.editorMenuPopover.hidden = true;
  elements.editorMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleEditorMenu() {
  const shouldOpen = elements.editorMenuPopover.hidden;
  elements.editorMenuPopover.hidden = !shouldOpen;
  elements.editorMenuBtn.setAttribute("aria-expanded", String(shouldOpen));
}

function closeSpecialKeyMenu() {
  elements.specialKeyMenuPopover.hidden = true;
  elements.specialKeyMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleSpecialKeyMenu(forceOpen = null) {
  if (state.composerSending) {
    return;
  }

  const shouldOpen = forceOpen === null ? elements.specialKeyMenuPopover.hidden : Boolean(forceOpen);
  elements.specialKeyMenuPopover.hidden = !shouldOpen;
  elements.specialKeyMenuBtn.setAttribute("aria-expanded", String(shouldOpen));
}

// Chat-style composer: one row that grows with its content up to the panel height.
function autosizeComposer() {
  const input = elements.sendTextInput;
  if (!input) {
    return;
  }
  const maxHeight = state.bottomPanelHeight || PANEL_HEIGHT_RANGE.default;
  const minHeight = state.bottomPanelPinned ? maxHeight : 0;
  input.style.height = "auto";
  const contentHeight = input.scrollHeight;
  input.style.height = `${Math.max(minHeight, Math.min(contentHeight, maxHeight))}px`;
  input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

function setComposerBusy(isBusy) {
  state.composerSending = Boolean(isBusy);
  elements.sendForm.classList.toggle("composer-busy", state.composerSending);
  elements.sendForm.setAttribute("aria-busy", String(state.composerSending));
  elements.sendTextBtn.disabled = state.composerSending;
  elements.sendRawTextBtn.disabled = state.composerSending;
  elements.specialKeyMenuBtn.disabled = state.composerSending;
  elements.attachImageBtn.disabled = state.composerSending;
  elements.removeImageBtn.disabled = state.composerSending;
  elements.imageInput.disabled = state.composerSending;
  elements.sendTextInput.readOnly = state.composerSending;
  elements.sendTextBtn.classList.toggle("is-sending", state.composerSending);
  elements.sendTextBtn.setAttribute("aria-label", state.composerSending ? "Sending" : "Send");
  if (state.composerSending) {
    closeSpecialKeyMenu();
  }
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
  const base = transport === "ssh" ? target?.sshTarget || "SSH" : "Local";
  return normalizeBackend(target?.backend) === "tmux" ? `${base} · tmux` : base;
}

function syncTargetBackendFormState(options = {}) {
  const backend = normalizeBackend(elements.targetBackend.value);
  const defaults = getBackendDefaults(backend);
  const previous = getBackendDefaults(backend === "tmux" ? "kitty" : "tmux");
  elements.targetKittyBinaryField.hidden = backend !== "kitty";
  elements.targetTmuxBinaryField.hidden = backend !== "tmux";
  elements.targetBackendSectionTitle.textContent = defaults.sectionTitle;
  elements.targetBackendSectionHint.textContent = defaults.sectionHint;
  elements.targetSocketPattern.placeholder = defaults.socketPlaceholder;
  elements.targetDefaultSocket.placeholder = defaults.defaultSocketPlaceholder;
  // Switching backends swaps an untouched socket pattern for the other default.
  if (options.swapSocketPattern && elements.targetSocketPattern.value.trim() === previous.socketPattern) {
    elements.targetSocketPattern.value = defaults.socketPattern;
  }
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
    backend: normalizeBackend(elements.targetBackend.value),
    sshTarget: elements.targetSsh.value.trim(),
    kittyBinary: elements.targetKittyBinary.value.trim(),
    tmuxBinary: elements.targetTmuxBinary.value.trim(),
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
  elements.targetBackend.value = normalizeBackend(source.backend);
  elements.targetSsh.value = source.sshTarget || "";
  elements.targetKittyBinary.value = source.kittyBinary || DEFAULT_TARGET_FORM.kittyBinary;
  elements.targetTmuxBinary.value = source.tmuxBinary || DEFAULT_TARGET_FORM.tmuxBinary;
  elements.targetSocketPattern.value = source.socketPattern || getBackendDefaults(source.backend).socketPattern;
  elements.targetDefaultSocket.value = source.defaultSocket || "";
  elements.targetNotes.value = source.notes || "";
  syncTargetBackendFormState();
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
          osWindowTitle: osWindow.title || "",
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
  const labels = state.sessionLabels;
  const text = kind === "tab" ? labels.createTab : kind === "split" ? labels.createSplit : labels.createWindow;
  return text.replace(/^New\s+/i, "").toLowerCase();
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
    setStatus("A create action is already running.", "neutral");
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
    if (result.windowId !== undefined && result.windowId !== null) {
      await selectWindow(result.windowId);
    }
    setStatus(`Created new ${label} #${result.windowId ?? ""}.`, "success");
  } finally {
    state.sessionCreating = false;
    syncSessionCreateControls();
  }
}

async function selectWindow(windowId) {
  const nextWindowId = Number(windowId);
  const selectionChanged = Number(state.selectedWindowId) !== nextWindowId;
  if (selectionChanged) {
    stashRenderedScreen();
  }
  state.selectedWindowId = nextWindowId;
  if (selectionChanged) {
    viewportScrolledBack = false;
  }
  rememberSelectedPane();
  noteScreenActivity();
  if (isMobileViewport()) {
    state.previewVisible = false;
    state.previewPinned = false;
    setMobileScreen("chat");
  }
  invalidateScreenRequests();
  const layoutPane = elements.screenOutput.querySelector(`.tmux-pane[data-layout-pane-id="${nextWindowId}"]`);
  if (selectionChanged && layoutPane) {
    elements.screenOutput.querySelectorAll(".tmux-pane.selected").forEach((node) => node.classList.remove("selected"));
    layoutPane.classList.add("selected");
    state.screenText = paneTextsFor(elements.screenOutput).get(nextWindowId) || "";
  } else if (selectionChanged && !restoreCachedScreen(nextWindowId)) {
    renderPaneLoading(nextWindowId);
  }
  renderSessions();
  renderMobilePaneSwitcher();
  renderViewerMeta();
  applyUiState();
  await refreshScreen({
    force: true,
    scrollToBottom: activeExtent() === "screen" || (activeExtent() === "all" && state.allTextFollowTail)
  });
  scheduleAutoFit();
}

// --- tmux pane sizing -------------------------------------------------------
// A tmux pane is as wide as its attached client, or 80x24 when it never had one,
// so lines stop short of the browser. Detached panes are resized to the cells
// that fit this view; attached ones only on request (see fitPaneToScreen).

// Size of one terminal cell in the screen output, measured from a two-line probe
// so the height is the real line box, not the glyph box.
function measureCellSize(output = elements.screenOutput) {
  const probe = document.createElement("pre");
  probe.textContent = `${"M".repeat(50)}\n${"M".repeat(50)}`;
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;margin:0;padding:0;border:0;pointer-events:none;font:inherit;line-height:inherit;";
  output.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  output.removeChild(probe);
  return { width: rect.width / 50, height: rect.height / 2 };
}

function measureScreenCells() {
  const output = elements.screenOutput;
  const cell = measureCellSize();
  const style = getComputedStyle(output);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  if (!cell.width || !cell.height || output.clientWidth === 0) {
    return null;
  }
  return {
    columns: clamp(Math.floor((output.clientWidth - padX) / cell.width), 20, 500),
    rows: clamp(Math.floor((output.clientHeight - padY) / cell.height), 5, 300)
  };
}

// With ?debug=1: the view geometry behind each auto-fit decision, appended to
// tmp/client-debug.log on the server.
function reportFitDiagnostics(info) {
  if (!clientDebugEnabled) {
    return;
  }
  try {
    const output = elements.screenOutput;
    const body = output.parentElement;
    const cell = measureCellSize();
    const payload = {
      source: "krd-fit-diag",
      build: CLIENT_BUILD,
      ua: navigator.userAgent,
      standalone: Boolean(navigator.standalone),
      inner: { w: window.innerWidth, h: window.innerHeight },
      output: { cw: output.clientWidth, ch: output.clientHeight, sh: output.scrollHeight, rect: output.getBoundingClientRect().toJSON() },
      body: body ? { ch: body.clientHeight, rect: body.getBoundingClientRect().toJSON() } : null,
      tree: elements.paneTree ? { ch: elements.paneTree.clientHeight } : null,
      cell,
      fontPx: state.uiFontSizePx,
      autoFit: state.autoFitPane,
      extent: activeExtent(),
      ...info
    };
    fetch("/api/client-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
  } catch (error) {
    // diagnostics only
  }
}

let autoFitTimer = null;
// Each local trigger (selection, viewport or font change, input, coming back
// to the foreground) opens an epoch. A window size that this view did not set
// (another deck client, or this one under an earlier layout) is re-fitted at
// most once per epoch, so two decks on the same pane cannot fight for it:
// the one the user is interacting with wins.
let autoFitEpoch = 0;
let externalFitEpoch = -1;

function queueAutoFit() {
  if (autoFitTimer) {
    clearTimeout(autoFitTimer);
  }
  autoFitTimer = setTimeout(() => {
    autoFitTimer = null;
    if (state.autoFitPane) {
      fitPaneToScreen().catch((error) => setStatus(error.message, "danger"));
    }
  }, 500);
}

function scheduleAutoFit() {
  autoFitEpoch += 1;
  queueAutoFit();
}

// The selected pane's window is a size other than this view's cell grid.
function scheduleExternalFit() {
  if (!state.autoFitPane || externalFitEpoch === autoFitEpoch) {
    return;
  }
  externalFitEpoch = autoFitEpoch;
  queueAutoFit();
}

function selectedWindowFitsView() {
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));
  const cells = pane && state.sessionBackend === "tmux" ? measureScreenCells() : null;
  if (!cells) {
    return true;
  }
  return (pane.window_columns || pane.columns) === cells.columns && (pane.window_lines || pane.lines) === cells.rows;
}

// Window size as reported by a screen capture; it may have changed since the
// session tree was loaded.
function noteWindowSize(windowId, columns, rows) {
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(windowId));
  if (!pane || !columns || !rows) {
    return;
  }
  pane.window_columns = columns;
  pane.window_lines = rows;
  if (Number(windowId) === Number(state.selectedWindowId) && !selectedWindowFitsView()) {
    scheduleExternalFit();
  }
}

async function fitPaneToScreen(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return null;
  }
  if (state.sessionBackend !== "tmux") {
    if (options.force) {
      setStatus("Pane resize is only available for tmux targets.", "warning");
    }
    return null;
  }
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));
  const cells = measureScreenCells();
  // Split panes share the window, so the window is what must match the view.
  const windowColumns = pane ? pane.window_columns || pane.columns : 0;
  const windowLines = pane ? pane.window_lines || pane.lines : 0;
  const skip = !pane || !cells
    ? "no pane or cells"
    : !options.force && (pane.is_attached || pane.osWindowFocused)
      ? "attached"
      : !options.force && windowColumns === cells.columns && windowLines === cells.rows
        ? "same size"
        : "";
  reportFitDiagnostics({ skip, cells, windowColumns, windowLines, force: Boolean(options.force) });
  if (skip) {
    return null;
  }

  const result = await apiFetch("/api/resize-window", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: state.selectedTargetId,
      socket: state.selectedSocket || "",
      windowId: state.selectedWindowId,
      columns: cells.columns,
      rows: cells.rows,
      force: Boolean(options.force)
    })
  });

  if (result.skipped) {
    setStatus("Pane kept its size: a terminal is attached. Use Fit pane to screen in the ⋯ menu to override.", "neutral");
    return result;
  }

  pane.window_columns = result.columns;
  pane.window_lines = result.rows;
  setStatus(
    `Window resized to ${result.columns}×${result.rows}` +
      (result.paneCount > 1 ? ` · ${result.paneCount} panes share it` : "") +
      (result.manualSize ? " · window-size manual; the attached terminal now sees a fixed canvas." : "."),
    "success"
  );
  await refreshScreen({ force: true, scrollToBottom: activeExtent() === "screen" || state.allTextFollowTail });
  return result;
}

// --- browser-side view splits ----------------------------------------------
// Modeled on deepseek-harness ui-layout: a device-local binary tree of views,
// persisted per origin. The active leaf holds #screenOutput and all the
// single-selection machinery; every other leaf is a read-only SecondaryViewer
// that polls its own pane. Phones show only the active leaf.

const leafSlots = new Map();
const secondaryViewers = new Map();
let paneTreeMobileMode = null;
let renderedTreeSignature = "";

function currentActor() {
  return {
    targetId: state.selectedTargetId || null,
    socket: state.selectedSocket || "",
    windowId: hasSelectedWindow() ? Number(state.selectedWindowId) : null
  };
}

function loadPaneLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANE_LAYOUT_STORAGE_KEY) || "null");
    if (parsed) {
      const decoded = PANE_TREE.decodePersistedPaneLayout(parsed);
      state.paneRoot = decoded.paneRoot;
      state.activePaneId = decoded.activePaneId;
      const activeId = parsed.activeLayoutId ?? parsed.activeProfileId;
      if (typeof activeId === "string" && decoded.paneRoot) {
        state.activeLayoutId = activeId;
        state.scratchLayout = decodeLayoutPayload(parsed.scratchLayout || parsed.sessionLayout);
      }
    }
  } catch (error) {
    state.paneRoot = null;
    state.activePaneId = null;
  }
}

function savePaneLayout() {
  try {
    localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        paneVersion: 1,
        paneRoot: state.paneRoot,
        activePaneId: state.activePaneId,
        activeLayoutId: state.activeLayoutId || undefined,
        scratchLayout: (state.activeLayoutId && state.scratchLayout) || undefined
      })
    );
  } catch (error) {
    // Storage can be unavailable; the layout then lasts for this page only.
  }
  scheduleLayoutAutosave();
  // Keeps the Scratch row's description current.
  renderLayouts();
}

// Layouts: a pane tree plus the pinned Browser, saved on the server
// (data/layouts.json) so the same layouts can be loaded from the desk, the
// iPad and the phone. A named layout is a live document: every change made
// while it is active is written back. "Scratch" is the unnamed layout of this
// device only; it is what you work in until you save it under a name.
const SCRATCH_LAYOUT_ID = "__scratch__";
const LAYOUT_AUTOSAVE_DELAY_MS = 600;
let layoutAutosaveTimer = 0;
let layoutApplying = false;

function normalizeBrowserState(raw) {
  if (!raw || typeof raw.url !== "string" || !raw.url) {
    return null;
  }
  return { url: raw.url, targetId: typeof raw.targetId === "string" ? raw.targetId : "" };
}

// A layout as the client stores and sends it: tree, active view, pinned Browser.
function decodeLayoutPayload(raw) {
  if (!raw) {
    return null;
  }
  const decoded = PANE_TREE.decodePersistedPaneLayout({ paneVersion: 1, paneRoot: raw.paneRoot, activePaneId: raw.activePaneId });
  if (!decoded.paneRoot) {
    return null;
  }
  return { paneRoot: decoded.paneRoot, activePaneId: decoded.activePaneId, browser: normalizeBrowserState(raw.browser) };
}

// The Browser belongs to a layout only while it is pinned. Phones never pin,
// so from a phone the layout keeps whatever Browser it already had.
function pinnedBrowserState() {
  if (isMobileViewport()) {
    const active = state.layouts.find((item) => item.id === state.activeLayoutId);
    return active ? normalizeBrowserState(active.browser) : null;
  }
  if (state.previewPinned && state.previewVisible && state.previewUrl) {
    return { url: state.previewUrl, targetId: state.previewTargetId || state.selectedTargetId || "" };
  }
  return null;
}

// The current layout without side effects (no selection sync), for comparisons.
function layoutSnapshot() {
  ensurePaneTree();
  return { paneRoot: state.paneRoot, activePaneId: state.activePaneId, browser: pinnedBrowserState() };
}

function currentLayoutPayload() {
  ensurePaneTree();
  syncActivePaneActor();
  return layoutSnapshot();
}

function scheduleLayoutAutosave() {
  if (!state.activeLayoutId || layoutApplying) {
    return;
  }
  clearTimeout(layoutAutosaveTimer);
  layoutAutosaveTimer = setTimeout(() => {
    layoutAutosaveTimer = 0;
    autosaveActiveLayout().catch((error) => setStatus(`Layout not saved: ${error.message}`, "danger"));
  }, LAYOUT_AUTOSAVE_DELAY_MS);
}

async function autosaveActiveLayout() {
  const layout = state.layouts.find((item) => item.id === state.activeLayoutId);
  if (!layout || layoutApplying) {
    return;
  }
  const payload = layoutSnapshot();
  const serialized = JSON.stringify(payload);
  if (serialized === state.activeLayoutSaved) {
    return;
  }
  const data = await apiFetch("/api/layouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: { id: layout.id, name: layout.name, ...payload } })
  });
  state.activeLayoutSaved = serialized;
  const index = state.layouts.findIndex((item) => item.id === data.layout.id);
  if (index >= 0) {
    state.layouts[index] = data.layout;
  }
  renderLayouts();
}

// Puts a layout on screen: tree, bound selection, pinned Browser.
async function applyLayoutPayload(payload) {
  layoutApplying = true;
  try {
    state.paneRoot = payload.paneRoot;
    state.activePaneId = payload.activePaneId;
    savePaneLayout();
    renderPaneTree();
    await bindSelectionToActor(activeLeaf().actor);
    if (isMobileViewport()) {
      return;
    }
    if (payload.browser) {
      const hasTarget = state.targets.some((item) => item.id === payload.browser.targetId);
      state.previewPinned = true;
      await loadUrlPreview(payload.browser.url, { targetId: hasTarget ? payload.browser.targetId : undefined, history: "reset" });
    } else if (state.previewPinned) {
      state.previewPinned = false;
      state.previewVisible = false;
      applyUiState();
    }
  } finally {
    layoutApplying = false;
  }
}

// Takes the server's copy of the active layout without touching the
// connection: used at start-up and on Reload, so edits made on another device win.
async function adoptActiveLayout() {
  const layout = state.layouts.find((item) => item.id === state.activeLayoutId);
  const payload = layout ? decodeLayoutPayload(layout) : null;
  if (!payload) {
    // Deleted elsewhere: the current tree carries on as Scratch.
    state.activeLayoutId = null;
    state.activeLayoutSaved = "";
    state.scratchLayout = null;
    savePaneLayout();
    return;
  }
  layoutApplying = true;
  try {
    state.paneRoot = payload.paneRoot;
    state.activePaneId = payload.activePaneId;
    savePaneLayout();
    renderPaneTree();
    if (!isMobileViewport()) {
      if (payload.browser) {
        state.previewTargetId = payload.browser.targetId || state.previewTargetId;
        rememberPreviewUrl(payload.browser.url, "reset");
        state.previewPinned = true;
        state.previewVisible = true;
        await refreshPreviewAccessToken();
        syncPreviewFrame();
      } else if (state.previewPinned) {
        state.previewPinned = false;
        state.previewVisible = false;
      }
      applyUiState();
    }
  } finally {
    layoutApplying = false;
  }
  state.activeLayoutSaved = JSON.stringify(layoutSnapshot());
}

// Switches back to Scratch. Returns false when it was already active.
async function activateScratchLayout() {
  if (!state.activeLayoutId) {
    return false;
  }
  const stash = state.scratchLayout;
  state.activeLayoutId = null;
  state.activeLayoutSaved = "";
  state.scratchLayout = null;
  if (stash) {
    await applyLayoutPayload(stash);
  } else {
    savePaneLayout();
  }
  renderLayouts();
  setStatus("Back to Scratch.", "neutral");
  return true;
}

async function loadLayouts(options = {}) {
  try {
    const data = await apiFetch("/api/layouts");
    state.layouts = Array.isArray(data.layouts) ? data.layouts : [];
  } catch (error) {
    state.layouts = [];
    elements.layoutSummary.textContent = `Layouts unavailable: ${error.message}`;
  }
  if (options.adoptActive && state.activeLayoutId) {
    await adoptActiveLayout();
  }
  renderLayouts();
}

function describeLayout(layout) {
  const leafNodes = PANE_TREE.leaves(layout.paneRoot);
  const parts = leafNodes.map((leafNode) => {
    const target = state.targets.find((item) => item.id === leafNode.actor.targetId);
    const name = target ? target.name : leafNode.actor.targetId || "unbound";
    return leafNode.actor.windowId === null ? name : `${name} #${leafNode.actor.windowId}`;
  });
  const browser = normalizeBrowserState(layout.browser);
  return `${leafNodes.length} view${leafNodes.length === 1 ? "" : "s"} · ${parts.join(", ")}${browser ? " · Browser" : ""}`;
}

function renderLayouts() {
  if (!elements.layoutList) {
    return;
  }
  const scratch = state.activeLayoutId ? state.scratchLayout : layoutSnapshot();
  const scratchRow = `
    <div class="layout-row reserved ${state.activeLayoutId ? "" : "active"}" data-layout-id="${SCRATCH_LAYOUT_ID}">
      <button class="layout-row-main" type="button" data-layout-action="load" title="The unsaved layout of this device. Work here, then save it under a name.">
        <strong>Scratch <span class="layout-badge">this device</span></strong>
        <small>${escapeHtml(scratch ? describeLayout(scratch) : "No views yet")}</small>
      </button>
    </div>
  `;
  const emptyNote = state.layouts.length
    ? ""
    : `<p class="empty-note">No saved layouts yet. Arrange your views, then save them with a name above.</p>`;
  elements.layoutList.innerHTML = scratchRow + emptyNote + state.layouts
    .map((layout) => {
      const active = layout.id === state.activeLayoutId ? "active" : "";
      return `
        <div class="layout-row ${active}" data-layout-id="${escapeHtml(layout.id)}">
          <button class="layout-row-main" type="button" data-layout-action="load" title="Switch to this layout">
            <strong>${escapeHtml(layout.name)}</strong>
            <small>${escapeHtml(describeLayout(layout))}</small>
          </button>
          <div class="layout-row-actions">
            <button class="icon-button" type="button" data-layout-action="duplicate" aria-label="Duplicate layout" title="Duplicate layout">⧉</button>
            <button class="icon-button" type="button" data-layout-action="delete" aria-label="Delete layout" title="Delete layout">×</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// Saves the current layout under a new name and switches to it. Saved from
// Scratch, a copy stays behind as Scratch.
async function saveLayoutAs(name) {
  const payload = currentLayoutPayload();
  const bound = PANE_TREE.leaves(payload.paneRoot).filter((leafNode) => leafNode.actor.windowId !== null);
  if (!bound.length) {
    setStatus("Pick a pane in at least one view before saving a layout.", "warning");
    return null;
  }
  if (state.layouts.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    setStatus(`A layout named “${name}” already exists.`, "warning");
    return null;
  }
  const data = await apiFetch("/api/layouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: { name, ...payload } })
  });
  if (!state.activeLayoutId) {
    state.scratchLayout = JSON.parse(JSON.stringify(payload));
  }
  state.activeLayoutId = data.layout.id;
  state.activeLayoutSaved = JSON.stringify(payload);
  savePaneLayout();
  await loadLayouts();
  setStatus(`Saved layout “${data.layout.name}”.`, "success");
  return data.layout;
}

async function applyLayout(layoutId) {
  const layout = state.layouts.find((item) => item.id === layoutId);
  const payload = layout ? decodeLayoutPayload(layout) : null;
  if (!payload) {
    return;
  }
  if (!state.activeLayoutId) {
    state.scratchLayout = layoutSnapshot();
  }
  state.activeLayoutId = layout.id;
  state.activeLayoutSaved = JSON.stringify(payload);
  await applyLayoutPayload(payload);
  state.activeLayoutSaved = JSON.stringify(layoutSnapshot());
  renderLayouts();
  if (isMobileViewport()) {
    setMobileScreen("chat");
  }
  setStatus(`Switched to layout “${layout.name}”.`, "success");
}

async function duplicateLayout(layoutId) {
  const layout = state.layouts.find((item) => item.id === layoutId);
  const payload = layout ? decodeLayoutPayload(layout) : null;
  if (!payload) {
    return;
  }
  const data = await apiFetch("/api/layouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: { name: `${layout.name} copy`, ...payload } })
  });
  await loadLayouts();
  setStatus(`Duplicated as “${data.layout.name}”.`, "success");
}

async function deleteLayout(layoutId) {
  const layout = state.layouts.find((item) => item.id === layoutId);
  if (!layout || !window.confirm(`Delete layout “${layout.name}”?`)) {
    return;
  }
  await apiFetch("/api/layouts/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: layoutId })
  });
  if (state.activeLayoutId === layoutId) {
    // The current tree carries on as Scratch.
    state.activeLayoutId = null;
    state.activeLayoutSaved = "";
    state.scratchLayout = null;
    savePaneLayout();
  }
  await loadLayouts();
  setStatus(`Deleted layout “${layout.name}”.`, "neutral");
}

// The "Save layout" button opens the Layouts view with the name field ready.
function openLayoutSaveForm() {
  if (isMobileViewport()) {
    setMobileScreen("layouts");
  } else {
    state.activeSidebarView = "layouts";
    state.sidebarVisible = true;
    applyUiState();
  }
  const active = state.layouts.find((item) => item.id === state.activeLayoutId);
  elements.layoutNameInput.value = active ? `${active.name} copy` : "";
  elements.layoutNameInput.focus();
  elements.layoutNameInput.select();
}

function ensurePaneTree() {
  if (!state.paneRoot || !PANE_TREE.hasPaneId(state.paneRoot, state.activePaneId)) {
    if (!state.paneRoot) {
      state.paneRoot = PANE_TREE.leaf(currentActor());
    }
    state.activePaneId = PANE_TREE.firstPaneId(state.paneRoot);
  }
}

function activeLeaf() {
  ensurePaneTree();
  return PANE_TREE.findPane(state.paneRoot, state.activePaneId);
}

// The active leaf always mirrors the current selection.
function syncActivePaneActor() {
  ensurePaneTree();
  state.paneRoot = PANE_TREE.replacePaneActor(state.paneRoot, state.activePaneId, currentActor());
  savePaneLayout();
  updateSlotHead(state.activePaneId);
}

function getLeafSlot(leafNode) {
  let slot = leafSlots.get(leafNode.id);
  if (slot) {
    return slot;
  }
  slot = document.createElement("div");
  slot.className = "pane-slot";
  slot.dataset.paneId = leafNode.id;
  slot.innerHTML = `
    <div class="pane-slot-head">
      <span class="pane-slot-title"></span>
      <span class="pane-slot-actions">
        <button class="pane-slot-button" type="button" data-pane-action="split-right" title="Split right" aria-label="Split right">◫</button>
        <button class="pane-slot-button" type="button" data-pane-action="split-down" title="Split down" aria-label="Split down">⊟</button>
        <button class="pane-slot-button" type="button" data-pane-action="close" title="Close view" aria-label="Close view">×</button>
      </span>
    </div>
    <div class="pane-slot-body"></div>
  `;
  const output = originalScreenOutput.__adopted ? createOutputElement() : originalScreenOutput;
  originalScreenOutput.__adopted = true;
  slot.querySelector(".pane-slot-body").replaceChildren(output);
  bindOutputElement(output);
  leafSlots.set(leafNode.id, slot);
  return slot;
}

function applySplitRatio(element, ratio) {
  element.style.setProperty("--first", `${ratio}fr`);
  element.style.setProperty("--second", `${1 - ratio}fr`);
}

function buildPaneNode(node) {
  if (node.kind === "leaf") {
    return getLeafSlot(node);
  }
  const split = document.createElement("div");
  split.className = `pane-split ${node.direction}`;
  split.dataset.splitId = node.id;
  applySplitRatio(split, node.ratio);
  const divider = document.createElement("div");
  divider.className = "pane-divider";
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", node.direction === "horizontal" ? "vertical" : "horizontal");
  split.append(buildPaneNode(node.first), divider, buildPaneNode(node.second));
  return split;
}

// Listeners live on each output element; they only act while that element is
// the active view (a click on another view activates it through the tree).
function bindOutputElement(output) {
  if (output.__bound) {
    return;
  }
  output.__bound = true;
  const whenActive = (handler) => (event) => (output === activeOutput ? handler(event) : undefined);
  output.addEventListener("click", whenActive(handleScreenPaneClick));
  // Passive as well: Screen mode forwards wheel steps at the edges without
  // needing preventDefault (overscroll-behavior already stops chaining).
  output.addEventListener("wheel", whenActive(queueRemoteScrollFromWheel), { passive: true });
  output.addEventListener("touchstart", whenActive(handleScreenTouchStart), { passive: true });
  // Passive on purpose: a blocking touchmove listener makes iOS scroll the
  // whole transcript on the main thread. Screen mode disables native vertical
  // panning with CSS touch-action instead and moves the pane itself.
  output.addEventListener("touchmove", whenActive(handleScreenTouchMove), { passive: true });
  output.addEventListener("touchend", whenActive(handleScreenTouchEnd), { passive: true });
  output.addEventListener("touchcancel", whenActive(handleScreenTouchEnd), { passive: true });
  output.addEventListener("scroll", whenActive(handleScreenOutputScroll), { passive: true });
  output.addEventListener("click", whenActive(handleScreenLinkClick));
  attachWheelContainmentTo(output);
}

async function handleScreenPaneClick(event) {
  const paneNode = event.target.closest?.(".tmux-pane");
  if (!paneNode || window.getSelection()?.toString()) {
    return;
  }
  const paneId = Number(paneNode.dataset.layoutPaneId);
  if (paneId !== Number(state.selectedWindowId)) {
    await selectWindow(paneId);
  }
}

async function handleScreenLinkClick(event) {
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
}

function createOutputElement() {
  const output = document.createElement("pre");
  output.className = "screen-output scroll-panel";
  output.textContent = "Loading view...";
  return output;
}

function slotOutput(paneId) {
  return leafSlots.get(paneId)?.querySelector(".screen-output") || null;
}

function treeSignature(node) {
  return node.kind === "leaf" ? node.id : `(${node.direction}:${treeSignature(node.first)},${treeSignature(node.second)})`;
}

// Hand the selection to another slot's element. The element being left keeps
// everything it shows and is picked up by a secondary viewer seeded with that
// screen; the element being entered already shows its last screen, which
// becomes the rendered screen so the next refresh only revalidates.
function setActiveOutput(paneId) {
  const output = slotOutput(paneId);
  if (!output || output === activeOutput) {
    return;
  }
  const previous = activeOutput;
  if (renderedScreen.key && renderedScreen.text === state.screenText && previous.getAttribute("aria-busy") !== "true") {
    const [targetId, socket, windowId, extent] = renderedScreen.key.split("|");
    secondaryScreenCache.set(paneLiveKey(targetId, socket, Number(windowId)), {
      hash: renderedScreen.hash,
      data: renderedScreen.data,
      text: renderedScreen.text,
      extent,
      followTail: state.allTextFollowTail,
      element: previous
    });
  }
  stashRenderedScreen();
  const viewer = secondaryViewers.get(paneId);
  activeOutput = output;
  if (outputResizeObserver) {
    outputResizeObserver.disconnect();
    outputResizeObserver.observe(output);
  }
  if (viewer) {
    viewer.destroy();
    secondaryViewers.delete(paneId);
  }
  if (viewer && viewer.hash && viewer.data && viewer.extent === state.screenExtent) {
    renderedScreen = {
      key: screenKeyFor(viewer.actor.targetId, viewer.actor.socket, viewer.actor.windowId, viewer.extent),
      hash: viewer.hash,
      text: viewer.text,
      data: viewer.data
    };
    state.screenText = viewer.text;
    if (viewer.extent === "all") {
      state.allTextFollowTail = viewer.followTail;
    }
  } else {
    renderedScreen = { key: "", hash: "", text: null, data: null };
    state.screenText = "";
  }
}

function destroySecondaryViewer(paneId) {
  const viewer = secondaryViewers.get(paneId);
  if (viewer) {
    viewer.destroy();
    secondaryViewers.delete(paneId);
  }
}

function sameActor(a, b) {
  return a.targetId === b.targetId && (a.socket || "") === (b.socket || "") && a.windowId === b.windowId;
}

function renderPaneTree() {
  ensurePaneTree();
  const container = elements.paneTree;
  const leavesNow = PANE_TREE.leaves(state.paneRoot);
  const liveIds = new Set(leavesNow.map((item) => item.id));
  leafSlots.forEach((slot, id) => {
    if (!liveIds.has(id)) {
      destroySecondaryViewer(id);
      leafSlots.delete(id);
      slot.remove();
    }
  });

  const mobile = isMobileViewport();
  const signature = mobile ? `mobile:${state.activePaneId}` : treeSignature(state.paneRoot);
  container.classList.toggle("single", leavesNow.length === 1);
  container.classList.toggle("mobile", mobile);
  if (signature !== renderedTreeSignature) {
    // Only splits, closes and the mobile/desktop switch rebuild the containers;
    // slots keep their elements, and scroll positions survive the re-insert.
    const scrolls = new Map();
    leafSlots.forEach((slot, id) => {
      const output = slot.querySelector(".screen-output");
      scrolls.set(id, [output.scrollTop, output.scrollLeft]);
    });
    container.replaceChildren(mobile ? getLeafSlot(activeLeaf()) : buildPaneNode(state.paneRoot));
    leafSlots.forEach((slot, id) => {
      const output = slot.querySelector(".screen-output");
      const saved = scrolls.get(id);
      if (saved && slot.isConnected) {
        output.scrollTop = saved[0];
        output.scrollLeft = saved[1];
      }
    });
    renderedTreeSignature = signature;
  }
  paneTreeMobileMode = mobile;
  setActiveOutput(state.activePaneId);

  leavesNow.forEach((leafNode) => {
    const slot = leafSlots.get(leafNode.id);
    if (!slot) {
      return;
    }
    slot.classList.toggle("active", leafNode.id === state.activePaneId);
    slot.querySelector(".screen-output").classList.toggle("secondary-output", leafNode.id !== state.activePaneId);
    if (leafNode.id === state.activePaneId) {
      return;
    }
    if (!slot.isConnected) {
      destroySecondaryViewer(leafNode.id);
      return;
    }
    const existing = secondaryViewers.get(leafNode.id);
    if (existing && sameActor(existing.actor, leafNode.actor)) {
      return;
    }
    destroySecondaryViewer(leafNode.id);
    secondaryViewers.set(leafNode.id, new SecondaryViewer(leafNode.id, leafNode.actor, slot.querySelector(".screen-output")));
  });
  leavesNow.forEach((leafNode) => updateSlotHead(leafNode.id));
  syncLiveSubscriptions();
}

function updateSlotHead(paneId) {
  const slot = leafSlots.get(paneId);
  const node = state.paneRoot ? PANE_TREE.findPane(state.paneRoot, paneId) : null;
  if (!slot || !node) {
    return;
  }
  const target = state.targets.find((item) => item.id === node.actor.targetId);
  const treePane = node.actor.targetId === state.selectedTargetId ? state.flatWindows.find((item) => Number(item.id) === node.actor.windowId) : null;
  const paneTitle = paneId === state.activePaneId ? selectedPane()?.title || "" : secondaryViewers.get(paneId)?.title || treePane?.title || "";
  slot.querySelector(".pane-slot-title").textContent = [
    target?.name || node.actor.targetId || "No target",
    node.actor.windowId !== null ? `#${node.actor.windowId}` : "no pane",
    paneTitle
  ]
    .filter(Boolean)
    .join(" · ");
}

// Last screen drawn for each pane by any view, so a view that is re-bound or
// re-created starts with content instead of a placeholder.
const secondaryScreenCache = new Map();

class SecondaryViewer {
  constructor(paneId, actor, output) {
    this.paneId = paneId;
    this.actor = actor;
    this.output = output;
    this.extent = state.screenExtent;
    this.hash = "";
    this.text = "";
    this.data = null;
    this.title = "";
    this.followTail = true;
    this.failures = 0;
    this.timer = null;
    this.destroyed = false;
    this.inFlight = false;
    this.pending = false;
    const cached = secondaryScreenCache.get(paneLiveKey(actor.targetId, actor.socket, actor.windowId));
    if (cached && cached.extent === this.extent) {
      this.hash = cached.hash;
      this.text = cached.text;
      this.data = cached.data;
      this.followTail = cached.followTail !== false;
      if (cached.element !== output) {
        this.draw(cached.data);
      }
    } else if (!output.__renderedLines && !output.querySelector(".tmux-window")) {
      this.output.textContent = "Loading view...";
    }
    this.poll();
  }

  get live() {
    return liveWindows.has(paneLiveKey(this.actor.targetId, this.actor.socket, this.actor.windowId));
  }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), this.live ? Math.max(delay, LIVE_POLL_MS) : delay);
  }

  // A live event arrived for this view: refresh now, or once more after the
  // refresh already running.
  trigger() {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.poll();
  }

  async poll() {
    if (this.destroyed) {
      return;
    }
    if (document.hidden || !this.output.isConnected) {
      this.schedule(SECONDARY_VIEW_POLL_MS);
      return;
    }
    if (!this.actor.targetId || this.actor.windowId === null) {
      this.output.textContent = "No pane bound. Click this view, then pick a pane in the sidebar.";
      return;
    }
    if (this.extent !== state.screenExtent) {
      this.extent = state.screenExtent;
      this.hash = "";
    }
    this.inFlight = true;
    try {
      const query = new URLSearchParams({
        targetId: this.actor.targetId,
        windowId: String(this.actor.windowId),
        extent: this.extent
      });
      if (this.actor.socket) {
        query.set("socket", this.actor.socket);
      }
      if (this.hash) {
        query.set("since", this.hash);
        if (typeof this.text === "string" && !this.data?.panes) {
          query.set("delta", "1");
        }
      }
      const data = await apiFetch(`/api/screen?${query.toString()}`);
      if (this.destroyed) {
        return;
      }
      if (data.delta) {
        if (data.base === this.hash && typeof this.text === "string") {
          data.text = TERMINAL_LINES.applyLineDelta(TERMINAL_LINES.splitLines(this.text), data).join("\n");
        } else {
          this.hash = "";
          this.schedule(0);
          this.inFlight = false;
          return;
        }
      }
      if (!data.unchanged) {
        this.hash = data.hash || "";
        this.data = data;
        this.draw(data);
        secondaryScreenCache.set(paneLiveKey(this.actor.targetId, this.actor.socket, this.actor.windowId), {
          hash: this.hash,
          data,
          text: this.text,
          extent: this.extent,
          followTail: this.followTail,
          element: this.output
        });
      }
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      this.hash = "";
      this.output.classList.remove("window-layout");
      delete this.output.dataset.layoutKey;
      this.output.textContent = `View unavailable: ${error.message}`;
    }
    this.inFlight = false;
    if (this.pending && !this.destroyed) {
      this.pending = false;
      this.poll();
      return;
    }
    this.schedule(Math.min(SECONDARY_VIEW_POLL_MS * (1 + this.failures), 15000));
  }

  draw(data) {
    if (Array.isArray(data.panes) && data.window) {
      const top = this.output.scrollTop;
      const left = this.output.scrollLeft;
      this.text = drawWindowLayout(this.output, data, this.actor.windowId, paneTextsFor(this.output));
      this.output.scrollTop = top;
      this.output.scrollLeft = left;
      const selected = data.panes.find((pane) => Number(pane.id) === this.actor.windowId);
      this.title = selected?.title || "";
    } else {
      const output = this.output;
      const nearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 48;
      const firstDraw = !output.__renderedLines;
      output.classList.remove("window-layout");
      delete output.dataset.layoutKey;
      this.text = data.text || "";
      renderTerminalLines(output, this.text, "(current screen is empty)");
      if (this.extent === "all" && (firstDraw || nearBottom || this.followTail)) {
        output.scrollTop = output.scrollHeight;
        this.followTail = true;
      } else if (this.extent === "all") {
        this.followTail = false;
      }
    }
    updateSlotHead(this.paneId);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
}

// Point the single-selection state at a view's pane, switching target when needed.
async function bindSelectionToActor(actor) {
  if (!actor.targetId || !state.targets.some((item) => item.id === actor.targetId)) {
    setStatus("This view has no target; pick a pane in the sidebar to bind it.", "warning");
    return;
  }
  const sameSelection =
    actor.targetId === state.selectedTargetId &&
    hasSelectedWindow() &&
    Number(state.selectedWindowId) === actor.windowId &&
    (state.selectedSocket || "") === (actor.socket || "");
  if (actor.targetId !== state.selectedTargetId) {
    state.selectedTargetId = actor.targetId;
    state.editingTargetId = actor.targetId;
    clearSessionSelection();
    const target = getSelectedTarget();
    writeTargetForm(target);
    renderSavedTargets();
    renderTargetSelect();
    setTargetHealth("Switching", "neutral");
    await apiFetch("/api/targets/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: actor.targetId })
    });
  }
  if (!sameSelection) {
    stashRenderedScreen();
    state.selectedSocket = actor.socket || "";
    state.selectedWindowId = actor.windowId;
    invalidateScreenRequests();
  }
  if (actor.windowId !== null) {
    const key = screenKeyFor(state.selectedTargetId, state.selectedSocket, actor.windowId, activeExtent());
    if (renderedScreen.key !== key && !restoreCachedScreen(actor.windowId)) {
      renderPaneLoading(actor.windowId);
    }
  }
  if (sameSelection) {
    await refreshScreen({ force: true });
    return;
  }
  await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "screen" });
}

async function activatePane(paneId, override = {}) {
  const leafNode = PANE_TREE.findPane(state.paneRoot, paneId);
  if (!leafNode) {
    return;
  }
  if (paneId === state.activePaneId) {
    if (override.windowId !== undefined && override.windowId !== Number(state.selectedWindowId)) {
      await selectWindow(override.windowId);
    }
    return;
  }
  const actor = PANE_TREE.normalizeActor({ ...leafNode.actor, ...override });
  state.paneRoot = PANE_TREE.replacePaneActor(state.paneRoot, paneId, actor);
  state.activePaneId = paneId;
  savePaneLayout();
  renderPaneTree();
  await bindSelectionToActor(actor);
}

async function splitActivePane(direction) {
  const current = activeLeaf();
  const { tree, newPaneId } = PANE_TREE.splitPane(state.paneRoot, current.id, direction, current.actor);
  if (!newPaneId) {
    setStatus("No room for another view.", "warning");
    return;
  }
  state.paneRoot = tree;
  savePaneLayout();
  // The new view starts on the same pane and takes focus, so the next sidebar pick lands in it.
  await activatePane(newPaneId);
  setStatus("View split. Pick a pane in the sidebar to show it here.", "neutral");
}

async function closeViewPane(paneId) {
  if (PANE_TREE.leaves(state.paneRoot).length <= 1) {
    setStatus("The last view stays open.", "neutral");
    return;
  }
  const wasActive = paneId === state.activePaneId;
  state.paneRoot = PANE_TREE.closePane(state.paneRoot, paneId);
  if (wasActive) {
    state.activePaneId = PANE_TREE.firstPaneId(state.paneRoot);
  }
  savePaneLayout();
  renderPaneTree();
  if (wasActive) {
    await bindSelectionToActor(activeLeaf().actor);
  }
}

function handlePaneTreeClick(event) {
  const action = event.target.closest?.("[data-pane-action]");
  const slot = event.target.closest?.(".pane-slot");
  if (!slot) {
    return;
  }
  const paneId = slot.dataset.paneId;
  if (action) {
    event.preventDefault();
    const kind = action.dataset.paneAction;
    const run =
      kind === "close"
        ? closeViewPane(paneId)
        : activatePane(paneId).then(() => splitActivePane(kind === "split-down" ? "vertical" : "horizontal"));
    run.catch((error) => setStatus(error.message, "danger"));
    return;
  }
  if (paneId === state.activePaneId || window.getSelection()?.toString()) {
    return;
  }
  const layoutPane = event.target.closest?.(".tmux-pane");
  const override = layoutPane ? { windowId: Number(layoutPane.dataset.layoutPaneId) } : {};
  activatePane(paneId, override).catch((error) => setStatus(error.message, "danger"));
}

function handleDividerPointerDown(event) {
  const divider = event.target.closest?.(".pane-divider");
  if (!divider || event.button > 0) {
    return;
  }
  const split = divider.parentElement;
  const horizontal = split.classList.contains("horizontal");
  event.preventDefault();
  divider.setPointerCapture(event.pointerId);
  divider.classList.add("dragging");
  let ratio = null;
  const move = (moveEvent) => {
    const rect = split.getBoundingClientRect();
    const raw = horizontal ? (moveEvent.clientX - rect.left) / rect.width : (moveEvent.clientY - rect.top) / rect.height;
    ratio = clamp(raw, 0.2, 0.8);
    applySplitRatio(split, ratio);
  };
  const finish = (endEvent) => {
    divider.classList.remove("dragging");
    divider.removeEventListener("pointermove", move);
    divider.removeEventListener("pointerup", finish);
    divider.removeEventListener("pointercancel", finish);
    try {
      divider.releasePointerCapture(endEvent.pointerId);
    } catch (error) {
      // Capture may already be gone.
    }
    if (ratio !== null) {
      state.paneRoot = PANE_TREE.resizePaneSplit(state.paneRoot, split.dataset.splitId, ratio);
      savePaneLayout();
    }
  };
  divider.addEventListener("pointermove", move);
  divider.addEventListener("pointerup", finish);
  divider.addEventListener("pointercancel", finish);
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
        windowInfo.tabTitle ? `${state.sessionLabels.tab}: ${windowInfo.tabTitle}` : "",
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
  const labels = state.sessionLabels;
  // tmux sessions are created and arranged from the terminal; the deck only adds sessions.
  const showNestedCreate = state.sessionBackend !== "tmux";
  const newWindowFooter = `
    <section class="os-window-create-block">
      <button
        class="ghost-button session-create-button create-window-card-button"
        id="createWindowBtn"
        type="button"
        data-create-session="window"
      >
        <span>${escapeHtml(labels.createWindow)}</span>
        <small>Create ${escapeHtml(labels.osWindow.toLowerCase())} #${state.sessionTree.length + 1}</small>
      </button>
    </section>
  `;

  elements.sessionSummary.textContent = selectedTarget
    ? `${selectedTarget.name} · ${state.sessionTree.length} ${labels.osWindow.toLowerCase()}s / ${totalWindows} panes`
    : "Choose a target from the top selector, then connect.";

  if (!state.sessionTree.length) {
    elements.sessionTree.innerHTML = `
      <div class="empty-note">No session data yet. Click Connect to load sessions.</div>
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
              if (window.is_attached) badges.push("attached");
              if (isPaneCached(window.id)) badges.push("cached");
              if (window.alternate_on) badges.push("alt-screen");
              if (window.zoomed) badges.push("zoomed");
              if (window.at_prompt) badges.push("prompt");

              return `
                <button class="pane-item ${activeClass}" type="button" data-window-id="${window.id}">
                  <div class="pane-item-head">
                    <strong>${escapeHtml(window.title || `Pane ${window.id}`)}</strong>
                    <span>#${window.id} ${closeButtonMarkup("pane", window.id, window.title || `Pane ${window.id}`)}</span>
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
                  <h4>${escapeHtml(tab.title || `${labels.tab} ${tab.id}`)}</h4>
                  <small>${escapeHtml(tab.layout || "")}</small>
                </div>
                <div class="session-head-actions">
                  <span>${escapeHtml(labels.tab.toLowerCase())} #${tab.id}</span>
                  ${closeButtonMarkup("tab", tab.id, tab.title || `${labels.tab} ${tab.id}`, (tab.windows || []).length)}
                  ${showNestedCreate ? `<button
                    class="ghost-button session-create-button"
                    type="button"
                    data-create-session="split"
                    data-tab-id="${escapeAttribute(tab.id)}"
                    data-source-window-id="${escapeAttribute(tabAnchor ? tabAnchor.id : "")}"
                    ${splitCreateDisabled}
                  >${escapeHtml(labels.createSplit)}</button>` : ""}
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
              <h3>${escapeHtml(osWindow.title ? `${labels.osWindow} ${osWindow.title}` : `${labels.osWindow} #${osWindow.id}`)}</h3>
              <small>${osWindow.title
                ? (osWindow.is_focused ? "attached" : "detached")
                : (osWindow.is_focused ? "focused now" : "background window")}</small>
            </div>
            <div class="session-head-actions">
              <span>${(osWindow.tabs || []).length} ${escapeHtml(labels.tab.toLowerCase())}s</span>
              ${state.sessionBackend === "tmux"
                ? closeButtonMarkup("session", osWindow.id, osWindow.title || `#${osWindow.id}`, countOsWindowPanes(osWindow))
                : ""}
              ${showNestedCreate ? `<button
                class="ghost-button session-create-button"
                type="button"
                data-create-session="tab"
                data-os-window-id="${escapeAttribute(osWindow.id)}"
                data-source-window-id="${escapeAttribute(osWindowAnchor ? osWindowAnchor.id : "")}"
                ${tabCreateDisabled}
              >${escapeHtml(labels.createTab)}</button>` : ""}
            </div>
          </div>
          ${tabs}
        </section>
      `;
    })
    .join("");

  elements.sessionTree.innerHTML = `${markup}${newWindowFooter}`;

  elements.sessionTree.querySelectorAll("[data-window-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      if (event.target.closest("[data-close-kind]") || Date.now() < suppressSessionClickUntil) {
        return;
      }
      await selectWindow(button.dataset.windowId);
    });
  });

  renderMobilePaneSwitcher();
  bindSessionCreateControls();
}

function countOsWindowPanes(osWindow) {
  return (osWindow.tabs || []).reduce((total, tab) => total + (tab.windows || []).length, 0);
}

// The close control lives inside the pane button, so it is a span, not a button.
function closeButtonMarkup(kind, id, title, paneCount = 1) {
  return `<span
    class="session-close-button"
    role="button"
    tabindex="0"
    aria-label="Close ${escapeAttribute(title)}"
    title="Close ${escapeAttribute(title)}"
    data-close-kind="${kind}"
    data-close-id="${escapeAttribute(id)}"
    data-close-title="${escapeAttribute(title)}"
    data-close-panes="${paneCount}"
  >×</span>`;
}

async function handleSessionCloseClick(event) {
  const control = event.target.closest?.("[data-close-kind]");
  if (!control) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!state.selectedTargetId) {
    return;
  }
  const kind = control.dataset.closeKind;
  const labels = state.sessionLabels;
  const kindLabel = { session: labels.osWindow, tab: labels.tab, pane: "pane" }[kind] || kind;
  const panes = Number(control.dataset.closePanes) || 1;
  const verb = state.sessionBackend === "tmux" ? "Kill" : "Close";
  const question =
    `${verb} ${kindLabel.toLowerCase()} "${control.dataset.closeTitle}"?` +
    (panes > 1 ? ` ${panes} panes and their processes will be closed.` : " Its process will be closed.");
  if (!window.confirm(question)) {
    return;
  }
  try {
    await apiFetch("/api/close-panel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: state.selectedTargetId,
        socket: state.selectedSocket || "",
        kind,
        id: Number(control.dataset.closeId)
      })
    });
    setStatus(`${kindLabel} "${control.dataset.closeTitle}" closed.`, "success");
    await loadSessions();
  } catch (error) {
    setStatus(error.message, "danger");
  }
}

function getSessionPaneFromEvent(event) {
  return event.target.closest?.("[data-window-id]") || null;
}

function handleSessionPointerDown(event) {
  const pane = getSessionPaneFromEvent(event);
  if (!pane || event.target.closest?.("[data-close-kind]") || !["touch", "pen"].includes(event.pointerType)) {
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
  state.previewVisible = false;
  if (isMobileViewport() && state.mobileScreen === "browser") {
    handleMobileBack();
    return;
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

async function reopenPreview() {
  if (!state.previewUrl) {
    setPreviewStatus("No Browser URL yet.", "neutral");
    return;
  }

  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function goBackPreview() {
  const nextHistory = PREVIEW_HISTORY.goBack(getPreviewHistoryState());
  if (!nextHistory) {
    closePreview();
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function goForwardPreview() {
  const nextHistory = PREVIEW_HISTORY.goForward(getPreviewHistoryState());
  if (!nextHistory) {
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function jumpPreviewHistory(index) {
  const nextHistory = PREVIEW_HISTORY.jump(getPreviewHistoryState(), index);
  if (!nextHistory) {
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function loadUrlPreview(rawUrl, options = {}) {
  const target = options.targetId
    ? state.targets.find((item) => item.id === options.targetId) || null
    : getSelectedTarget();

  if (!target) {
    setPreviewStatus("Choose a connection target first.", "warning");
    return;
  }

  const url = normalizeBrowserUrl(rawUrl);

  state.previewTargetId = target.id;
  rememberPreviewUrl(url, options.history || "push");
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  renderReports();
  // On a phone the Browser is its own screen, reached from the terminal or
  // from the Reports list.
  if (isMobileViewport() && state.mobileScreen !== "browser") {
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
    path.includes(elements.browserSidebarView) ||
    path.includes(elements.showBrowserViewBtn)
  ) {
    // The Browser view (reports, address field) belongs to the Browser.
    return;
  }

  state.previewVisible = false;
  if (isMobileViewport() && state.mobileScreen === "browser") {
    handleMobileBack();
    return;
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

  if (message.targetId && message.targetId !== state.previewTargetId) {
    return;
  }

  if (message.type === "browser:navigate") {
    loadUrlPreview(message.url, { targetId: state.previewTargetId }).catch((error) => setPreviewStatus(error.message, "danger"));
    return;
  }

  if (message.type === "browser:loaded") {
    try {
      const url = normalizeBrowserUrl(message.url);
      replaceLoadedPreviewUrl(url);
      setPreviewStatus(`Loaded ${url}`, "neutral");
      applyUiState();
      recordReport(url, message.title).catch(() => {});
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
    return;
  }

  if (message.type === "browser:title" && message.title) {
    try {
      recordReport(normalizeBrowserUrl(message.url), message.title).catch(() => {});
    } catch (error) {
      // Not a listable URL.
    }
  }
}

// Reports: the Browser's own list, kept on the server like layouts.
const reportTitles = new Map();

async function loadReports() {
  try {
    const data = await apiFetch("/api/reports");
    state.reports = Array.isArray(data.reports) ? data.reports : [];
  } catch (error) {
    state.reports = [];
    elements.reportSummary.textContent = `Reports unavailable: ${error.message}`;
  }
  renderReports();
}

async function recordReport(url, title = "") {
  const targetId = state.previewTargetId || state.selectedTargetId;
  if (!targetId || !url) {
    return;
  }
  const key = `${targetId} ${url}`;
  const cleanTitle = String(title || "").trim();
  if (cleanTitle && reportTitles.get(key) === cleanTitle) {
    return;
  }
  if (cleanTitle) {
    reportTitles.set(key, cleanTitle);
  }
  await apiFetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, url, title: cleanTitle })
  });
  await loadReports();
}

function describeReport(report) {
  const target = state.targets.find((item) => item.id === report.targetId);
  return `${target ? target.name : report.targetId} · ${report.url}`;
}

function reportLabel(report) {
  if (report.title) {
    return report.title;
  }
  try {
    const parsed = new URL(report.url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) + (parsed.pathname.endsWith("/") ? "/" : "") : parsed.host || report.url;
  } catch (error) {
    return report.url;
  }
}

function renderReports() {
  if (!elements.reportList) {
    return;
  }
  if (!state.reports.length) {
    elements.reportList.innerHTML = `<p class="empty-note">Nothing opened yet. Click a link in the terminal or enter a path above.</p>`;
    return;
  }
  elements.reportList.innerHTML = state.reports
    .map((report) => {
      const active = report.url === state.previewUrl && report.targetId === state.previewTargetId ? "active" : "";
      return `
        <div class="layout-row report-row ${active}" data-report-id="${escapeHtml(report.id)}">
          <button class="layout-row-main" type="button" data-report-action="open" title="${escapeHtml(report.url)}">
            <strong>${escapeHtml(reportLabel(report))}</strong>
            <small>${escapeHtml(describeReport(report))}</small>
          </button>
          <div class="layout-row-actions">
            <button class="icon-button ${report.pinned ? "active" : ""}" type="button" data-report-action="pin" aria-label="${report.pinned ? "Unpin" : "Pin"}" title="${report.pinned ? "Unpin" : "Pin to the top"}">${report.pinned ? "★" : "☆"}</button>
            <button class="icon-button" type="button" data-report-action="delete" aria-label="Remove from the list" title="Remove from the list">×</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function openReport(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) {
    return;
  }
  await loadUrlPreview(report.url, { history: "reset", targetId: report.targetId });
}

async function toggleReportPin(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) {
    return;
  }
  await apiFetch("/api/reports/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: reportId, pinned: !report.pinned })
  });
  await loadReports();
}

async function deleteReport(reportId) {
  await apiFetch("/api/reports/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: reportId })
  });
  await loadReports();
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
    resetMobileStack("connect");
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  }
  renderSocketOptions([], "");
  renderSessions();
  renderViewerMeta();
  renderImageAttachment();
  state.sessionLabels = labelsForTarget(getSelectedTarget());
  state.sessionBackend = normalizeBackend(getSelectedTarget()?.backend);
  elements.screenOutput.textContent = "Waiting for a pane...";
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
  if (result.labels) {
    state.sessionLabels = result.labels;
  }
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
  await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
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
  state.sessionLabels = data.labels || labelsForTarget(getSelectedTarget());
  state.sessionBackend = normalizeBackend(data.backend || getSelectedTarget()?.backend);
  state.flatWindows = flattenWindows(state.sessionTree);
  state.selectedSocket = data.selectedSocket || "";
  renderSocketOptions(data.sockets || [], state.selectedSocket);

  const restoredWindowId = hasSelectedWindow() ? null : findRestorablePane(capturedTargetId);
  if (restoredWindowId !== null) {
    state.selectedWindowId = restoredWindowId;
  } else if (deferPaneRefresh && state.selectedWindowId) {
    if (!state.flatWindows.some((window) => Number(window.id) === Number(state.selectedWindowId))) {
      state.selectedWindowId = null;
    }
  } else if (!deferPaneRefresh && !hasSelectedWindow() && state.flatWindows[0]) {
    state.selectedWindowId = Number(state.flatWindows[0].id);
  } else if (
    !deferPaneRefresh &&
    hasSelectedWindow() &&
    !state.flatWindows.some((window) => Number(window.id) === Number(state.selectedWindowId))
  ) {
    state.selectedWindowId = state.flatWindows[0] ? Number(state.flatWindows[0].id) : null;
  }

  const selectedWindowChanged = Number(previousWindowId) !== Number(state.selectedWindowId);
  rememberSelectedPane();
  if (selectedWindowChanged) {
    invalidateScreenRequests();
    if (hasSelectedWindow() && !deferPaneRefresh) {
      renderPaneLoading(state.selectedWindowId);
    }
  }

  renderSessions();
  renderViewerMeta();
  setTargetHealth("Connected", "success");
  updateStatusBar();
  sendClientDebug("loadSessions:rendered", null, { force: true });
  if (hasSelectedWindow() && !selectedWindowChanged && !selectedWindowFitsView()) {
    scheduleExternalFit();
  }

  if (hasSelectedWindow() && !deferPaneRefresh) {
    if (options.refreshPane !== false) {
      await refreshScreen({
        force: Boolean(options.forceRefresh),
        scrollToBottom: Boolean(options.scrollToBottom || (selectedWindowChanged && activeExtent() === "screen"))
      });
    } else if (selectedWindowChanged) {
      state.screenText = "";
      elements.screenOutput.textContent = "The current pane changed. Click Refresh to update content.";
    }
  } else if (!hasSelectedWindow()) {
    elements.screenOutput.textContent = deferPaneRefresh
      ? "Select a session before loading pane content."
      : "No pane is available to display.";
  }
}

async function refreshScreen(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }

  if (state.refreshing && !options.force) {
    return;
  }

  if (activeExtent() === "all" && !state.allTextFollowTail && !options.force) {
    setStatus("Browsing history · All auto refresh paused.", "neutral");
    return;
  }

  const requestSerial = ++screenRequestSerial;
  const capturedTargetId = state.selectedTargetId;
  const capturedSocket = state.selectedSocket;
  const capturedWindowId = state.selectedWindowId;
  const capturedExtent = activeExtent();
  if (screenAbortController) {
    screenAbortController.abort();
  }
  const requestController = new AbortController();
  screenAbortController = requestController;
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

    const screenKey = `${capturedTargetId}|${capturedSocket}|${capturedWindowId}|${capturedExtent}`;
    // Loading/error placeholders clear state.screenText, which disables the shortcut.
    const canSkipUnchanged =
      renderedScreen.key === screenKey &&
      state.screenText !== "" &&
      renderedScreen.text === state.screenText &&
      elements.screenOutput.getAttribute("aria-busy") !== "true";
    if (canSkipUnchanged && renderedScreen.hash && !options.noDelta) {
      query.set("since", renderedScreen.hash);
      query.set("delta", "1");
    }

    const data = await apiFetch(`/api/screen?${query.toString()}`, {
      signal: requestController.signal
    });
    if (data.delta) {
      // The server described the new text relative to the one we rendered.
      if (canSkipUnchanged && data.base === renderedScreen.hash && typeof renderedScreen.text === "string") {
        data.text = TERMINAL_LINES.applyLineDelta(TERMINAL_LINES.splitLines(renderedScreen.text), data).join("\n");
      } else if (requestSerial === screenRequestSerial) {
        state.refreshing = false;
        return refreshScreen({ ...options, force: true, noDelta: true });
      }
    }
    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId) &&
      capturedExtent === activeExtent()
    ) {
      if (data.unchanged && canSkipUnchanged) {
        renderScreenData(renderedScreen.data || { text: state.screenText }, options);
      } else {
        const nextText = data.text || "";
        if (renderedScreen.key === screenKey && nextText !== state.screenText) {
          noteScreenActivity();
        }
        renderScreenData(data, options);
        renderedScreen = { key: screenKey, hash: data.hash || "", text: state.screenText, data };
        rememberScreen(renderedScreen);
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId)
    ) {
      state.screenText = "";
      leaveWindowLayout();
      elements.screenOutput.textContent = `Pane #${capturedWindowId} could not be loaded. Click Refresh to try again.`;
      elements.screenOutput.setAttribute("aria-busy", "false");
      elements.screenOutput.dataset.paneId = String(capturedWindowId);
    }
    throw error;
  } finally {
    if (requestSerial === screenRequestSerial) {
      state.refreshing = false;
      if (screenAbortController === requestController) {
        screenAbortController = null;
      }
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

function queueRemoteScrollLines(lines) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  pendingScrollLines += lines;

  if (scrollFlushTimer) {
    clearTimeout(scrollFlushTimer);
  }

  scrollFlushTimer = setTimeout(flushRemoteScroll, WHEEL_SCROLL_DEBOUNCE_MS);
  return true;
}

function queueRemoteScrollFromWheel(event) {
  if (activeExtent() !== "screen") {
    return;
  }

  if (!shouldForwardWheelToKitty(event)) {
    return;
  }

  event.stopImmediatePropagation();

  queueRemoteScrollLines(wheelDeltaToLines(event));
}

function handleScreenTouchStart(event) {
  if (event.touches.length !== 1) {
    screenTouchScroll = null;
    return;
  }

  screenTouchScroll = {
    lastY: event.touches[0].clientY
  };
}

function handleScreenTouchMove(event) {
  if (activeExtent() !== "screen" || !screenTouchScroll || event.touches.length !== 1) {
    return;
  }

  const nextY = event.touches[0].clientY;
  const deltaY = screenTouchScroll.lastY - nextY;
  screenTouchScroll.lastY = nextY;

  if (!shouldForwardScrollDeltaToKitty(deltaY)) {
    // Native panning is off in Screen mode (touch-action), so scroll the
    // wrapped viewport text locally until an edge is reached.
    event.currentTarget.scrollTop += deltaY;
    return;
  }

  queueRemoteScrollLines((deltaY / TOUCH_SCROLL_LINE_PX) * TOUCH_SCROLL_SENSITIVITY);
}

function handleScreenTouchEnd() {
  screenTouchScroll = null;
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

async function scrollRemoteWindow(lines, options = {}) {
  const toEnd = Boolean(options.toEnd);
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
        lines,
        toEnd
      })
    });

    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId) &&
      activeExtent() === "screen"
    ) {
      if (toEnd) {
        viewportScrolledBack = false;
      } else if (lines < 0) {
        viewportScrolledBack = true;
      }
      renderScrolledPaneText(data.text || "", toEnd ? { scrollToBottom: true } : {});
      setStatus(
        toEnd
          ? `Pane #${state.selectedWindowId} is showing its latest output.`
          : `Scrolled pane #${state.selectedWindowId} by ${Math.abs(lines)} lines.`,
        "success"
      );
    }
  } finally {
    if (requestSerial === screenRequestSerial) {
      state.refreshing = false;
    }
  }
}

async function sendText(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  const text = elements.sendTextInput.value;
  if (text.length === 0) {
    setStatus("Type something before sending.", "warning");
    return false;
  }

  const pane = captureSelectedPane();
  scheduleAutoFit();
  await apiFetch("/api/send-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: pane.targetId,
      socket: pane.socket,
      windowId: pane.windowId,
      text,
      appendNewline: Boolean(options.appendNewline)
    })
  });

  setStatus(
    options.appendNewline
      ? `Text sent to pane #${pane.windowId} and submitted.`
      : `Text sent to pane #${pane.windowId}.`,
    "success"
  );
  elements.sendTextInput.value = "";
  autosizeComposer();
  noteScreenActivity();
  if (isPaneStillSelected(pane)) {
    await refreshScreen({ scrollToBottom: true });
  }
  return true;
}

async function sendImageAttachment(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  const attachment = state.imageAttachment;
  if (!attachment) {
    setStatus("Attach an image first.", "warning");
    return false;
  }

  const text = elements.sendTextInput.value;
  const pane = captureSelectedPane();
  setStatus(`Uploading and sending ${attachment.name}...`, "neutral");
  const data = await apiFetch("/api/send-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: pane.targetId,
      socket: pane.socket,
      windowId: pane.windowId,
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
  autosizeComposer();
  clearImageAttachment();
  noteScreenActivity();
  if (isPaneStillSelected(pane)) {
    await refreshScreen({ scrollToBottom: true });
  }
  return data;
}

async function sendComposerPayload(options = {}) {
  return runComposerAction(async () => {
    if (state.imageAttachment) {
      return sendImageAttachment(options);
    }

    return sendText(options);
  });
}

async function runComposerAction(action) {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Please wait.", "neutral");
    return false;
  }

  setComposerBusy(true);
  try {
    return await action();
  } finally {
    setComposerBusy(false);
  }
}

async function sendComposerKey(key, repeat = 1) {
  return runComposerAction(() => sendKey(key, repeat));
}

// `key` is one key name, or an array for a chord such as ["ctrl+x", "ctrl+s"].
async function sendKey(key, repeat = 1) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return;
  }

  const keys = Array.isArray(key) ? key : null;
  const pane = captureSelectedPane();
  scheduleAutoFit();
  await apiFetch("/api/send-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: pane.targetId,
      socket: pane.socket,
      windowId: pane.windowId,
      key: keys ? keys[0] : key,
      keys: keys || undefined,
      repeat
    })
  });

  const sent = keys ? keys.join(" ") : `${key}${repeat > 1 ? ` ×${repeat}` : ""}`;
  setStatus(`Sent key ${sent} to pane #${pane.windowId}.`, "success");
  noteScreenActivity();
  if (isPaneStillSelected(pane)) {
    await refreshScreen({ scrollToBottom: true });
  }
}

async function focusWindow() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
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
  const action = COMPOSER_UTILS.getEnterAction(elements.sendTextInput.value, {
    hasImage: Boolean(state.imageAttachment)
  });

  if (action.type === "send-composer") {
    return sendComposerPayload({ appendNewline: action.appendNewline });
  }

  if (action.type === "send-text") {
    return runComposerAction(() => sendText({ appendNewline: action.appendNewline }));
  }

  if (action.type === "send-key") {
    return sendComposerKey(action.key);
  }

  return false;
}

async function setScreenExtent(extent) {
  const nextExtent = extent === "all" ? "all" : "screen";
  if (state.screenExtent === nextExtent) {
    return;
  }

  state.screenExtent = nextExtent;
  state.screenExtentExplicit = true;
  state.allTextFollowTail = true;
  invalidateScreenRequests();
  pendingScrollLines = 0;
  if (scrollFlushTimer) {
    clearTimeout(scrollFlushTimer);
    scrollFlushTimer = null;
  }

  applyUiState();
  await refreshScreen({ force: true, scrollToBottom: true });
  setStatus(
    nextExtent === "all"
      ? "Transcript: this pane's text and scrollback, scrolled in the browser."
      : "Screen: the live window; swipes and the wheel scroll the pane itself.",
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

// ---- Live updates -----------------------------------------------------------
// One EventSource carries every tmux pane this page shows (primary view and
// split views). The server watches each pane's session through a tmux
// control-mode client and sends `screen` when the pane's window changes; the
// page then re-fetches through the same /api/screen path polling uses.
let liveSource = null;
let liveSubsKey = "";
let liveWindows = new Set();
let liveSyncTimer = null;
let liveReconnectTimer = null;
let liveReconnectDelay = 3000;
let liveRefreshRunning = false;
let liveRefreshPending = false;
let liveRefreshTimer = null;
let lastLiveRefreshAt = 0;

function paneLiveKey(targetId, socket, windowId) {
  return `${targetId || ""}|${socket || ""}|${windowId}`;
}

function isPrimaryLive() {
  return hasSelectedWindow() && liveWindows.has(paneLiveKey(state.selectedTargetId, state.selectedSocket, Number(state.selectedWindowId)));
}

function desiredLiveSubscriptions() {
  const subs = new Map();
  const add = (targetId, socket, windowId) => {
    const target = state.targets.find((item) => item.id === targetId);
    if (!target || target.backend !== "tmux" || windowId === null || windowId === undefined) {
      return;
    }
    subs.set(paneLiveKey(targetId, socket, Number(windowId)), { targetId, socket: socket || "", windowId: Number(windowId) });
  };
  if (state.selectedTargetId && hasSelectedWindow()) {
    add(state.selectedTargetId, state.selectedSocket, state.selectedWindowId);
  }
  secondaryViewers.forEach((viewer) => add(viewer.actor.targetId, viewer.actor.socket, viewer.actor.windowId));
  return [...subs.values()];
}

function syncLiveSubscriptions() {
  clearTimeout(liveSyncTimer);
  liveSyncTimer = setTimeout(() => {
    liveSyncTimer = null;
    if (!state.authenticated || document.hidden || typeof EventSource === "undefined") {
      closeLiveSource();
      return;
    }
    const subs = desiredLiveSubscriptions();
    const key = JSON.stringify(subs);
    if (!subs.length) {
      closeLiveSource();
      return;
    }
    if (liveSource && key === liveSubsKey) {
      return;
    }
    openLiveSource(subs, key);
  }, LIVE_RESUBSCRIBE_DEBOUNCE_MS);
}

function openLiveSource(subs, key) {
  closeLiveSource({ keepDelay: true });
  liveSubsKey = key;
  const source = new EventSource(`/api/events?subs=${encodeURIComponent(JSON.stringify(subs))}`);
  liveSource = source;
  source.addEventListener("open", () => {
    liveReconnectDelay = 3000;
  });
  // The server names the subscriptions it could attach a watcher to.
  source.addEventListener("subscribed", (event) => {
    const data = parseLiveEvent(event);
    const live = Array.isArray(data.live) ? data.live : [];
    setLiveWindows(new Set(live.map((item) => paneLiveKey(item.targetId, item.socket, Number(item.windowId)))));
  });
  source.addEventListener("screen", (event) => handleLiveScreenEvent(parseLiveEvent(event)));
  source.addEventListener("tree", () => {
    loadSessions({ refreshPane: false }).catch(() => {});
  });
  source.addEventListener("reset", () => {
    scheduleLiveReconnect();
  });
  source.addEventListener("error", () => {
    // EventSource retries network drops itself; a closed stream (HTTP error,
    // server restart) needs our own backoff.
    setLiveWindows(new Set());
    if (source.readyState === EventSource.CLOSED) {
      scheduleLiveReconnect();
    }
  });
}

function parseLiveEvent(event) {
  try {
    return JSON.parse(event.data);
  } catch (error) {
    return {};
  }
}

function setLiveWindows(next) {
  const changed = next.size !== liveWindows.size || [...next].some((item) => !liveWindows.has(item));
  liveWindows = next;
  if (!changed) {
    return;
  }
  updateStatusBar();
  if (pollTimer && state.autoRefresh) {
    schedulePoll(getPollDelayMs());
  }
}

function scheduleLiveReconnect() {
  closeLiveSource({ keepDelay: true });
  clearTimeout(liveReconnectTimer);
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    liveSubsKey = "";
    syncLiveSubscriptions();
  }, liveReconnectDelay);
  liveReconnectDelay = Math.min(liveReconnectDelay * 2, LIVE_RECONNECT_MAX_MS);
}

function closeLiveSource(options = {}) {
  if (liveSource) {
    liveSource.close();
    liveSource = null;
  }
  liveSubsKey = "";
  if (!options.keepDelay) {
    clearTimeout(liveReconnectTimer);
    liveReconnectTimer = null;
    liveReconnectDelay = 3000;
  }
  setLiveWindows(new Set());
}

function handleLiveScreenEvent(data) {
  const key = paneLiveKey(data.targetId, data.socket, Number(data.windowId));
  if (hasSelectedWindow() && key === paneLiveKey(state.selectedTargetId, state.selectedSocket, Number(state.selectedWindowId))) {
    requestLiveRefresh();
  }
  secondaryViewers.forEach((viewer) => {
    if (paneLiveKey(viewer.actor.targetId, viewer.actor.socket, viewer.actor.windowId) === key) {
      viewer.trigger();
    }
  });
}

// Coalesce bursts: one refresh in flight, at most one queued, and a minimum
// gap per extent so "All" never re-downloads history on every output chunk.
function requestLiveRefresh() {
  if (liveRefreshRunning) {
    liveRefreshPending = true;
    return;
  }
  const gap = LIVE_MIN_GAP_MS[activeExtent()] || LIVE_MIN_GAP_MS.screen;
  const wait = Math.max(0, lastLiveRefreshAt + gap - Date.now());
  if (liveRefreshTimer) {
    return;
  }
  liveRefreshTimer = setTimeout(runLiveRefresh, wait);
}

async function runLiveRefresh() {
  liveRefreshTimer = null;
  if (!state.selectedTargetId || !hasSelectedWindow() || document.hidden) {
    return;
  }
  if (activeExtent() === "all" && !state.allTextFollowTail) {
    return;
  }
  liveRefreshRunning = true;
  lastLiveRefreshAt = Date.now();
  try {
    await refreshScreen({ force: true });
  } catch (error) {
    setStatus(error.message, "danger");
  } finally {
    liveRefreshRunning = false;
  }
  if (liveRefreshPending) {
    liveRefreshPending = false;
    requestLiveRefresh();
  }
}

function stopPolling() {
  pollGeneration += 1;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function getPollDelayMs() {
  if (isPrimaryLive()) {
    return LIVE_POLL_MS;
  }
  const quietFor = Date.now() - lastScreenActivityAt;
  if (quietFor < POLL_ACTIVE_WINDOW_MS) {
    return POLL_ACTIVE_MS;
  }
  if (quietFor < POLL_WARM_WINDOW_MS) {
    return POLL_WARM_MS;
  }
  return POLL_IDLE_MS;
}

function schedulePoll(delayMs) {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  const generation = pollGeneration;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (generation !== pollGeneration) {
      return;
    }

    if (state.selectedTargetId && !document.hidden) {
      pollInFlight = true;
      try {
        await runAutoRefreshTick();
      } catch (error) {
        setStatus(error.message, "danger");
        setTargetHealth("Connection issue", "danger");
      } finally {
        pollInFlight = false;
      }
    }

    // Hidden pages stop here; the visibilitychange handler resumes polling.
    if (generation === pollGeneration && !document.hidden) {
      schedulePoll(getPollDelayMs());
    }
  }, delayMs);
}

function restartPolling() {
  stopPolling();

  if (!state.autoRefresh || !state.authenticated) {
    return;
  }

  lastTreeRefreshAt = Date.now();
  lastAllTextRefreshAt = Date.now();
  schedulePoll(getPollDelayMs());
}

// Called when the pane output changes or input is sent: speeds polling back up.
function noteScreenActivity() {
  lastScreenActivityAt = Date.now();
  if (pollTimer && state.autoRefresh && !isPrimaryLive()) {
    schedulePoll(POLL_ACTIVE_MS);
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    closeLiveSource();
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    return;
  }
  syncLiveSubscriptions();
  scheduleAutoFit();

  // An in-flight tick reschedules itself once it finishes.
  if (state.autoRefresh && state.authenticated && !pollTimer && !pollInFlight) {
    schedulePoll(0);
  }
}

async function runAutoRefreshTick() {
  const now = Date.now();
  const refreshTree = now - lastTreeRefreshAt >= SESSION_TREE_REFRESH_MS || !state.flatWindows.length;
  if (refreshTree) {
    lastTreeRefreshAt = now;
  }

  if (!hasSelectedWindow()) {
    await loadSessions({ forceRefresh: true });
    return;
  }

  if (activeExtent() === "all") {
    if (!state.allTextFollowTail) {
      if (refreshTree) {
        await loadSessions({ refreshPane: false });
      }
      setStatus("Browsing history · All auto refresh paused.", "neutral");
      return;
    }

    if (now - lastAllTextRefreshAt < ALL_TEXT_AUTO_REFRESH_MS) {
      if (refreshTree) {
        await loadSessions({ refreshPane: false });
      }
      return;
    }
    lastAllTextRefreshAt = now;
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

function renderTerminalText(text) {
  if (ANSI_UTILS && typeof ANSI_UTILS.renderAnsiTerminalText === "function") {
    return ANSI_UTILS.renderAnsiTerminalText(text);
  }

  return linkifyTerminalText(text);
}

// Draw terminal text as one block per line and only touch the lines that
// changed since the previous draw into the same element. tmux starts every
// captured line from default attributes, so lines render independently.
function renderTerminalLines(output, text, placeholder) {
  if (!text) {
    output.textContent = placeholder;
    output.__renderedLines = null;
    return;
  }
  TERMINAL_LINES.renderLines(output, TERMINAL_LINES.splitLines(text), renderTerminalText);
}

function attachWheelContainment() {
  document.querySelectorAll(".scroll-panel").forEach(attachWheelContainmentTo);
}

function attachWheelContainmentTo(panel) {
  if (panel.__wheelContained) {
    return;
  }
  panel.__wheelContained = true;
  {
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
  }
}

function setSidebarView(view) {
  const nextView = SIDEBAR_VIEW_SET.has(view) ? view : "sessions";
  if (state.sidebarVisible && state.activeSidebarView === nextView) {
    state.sidebarVisible = false;
  } else {
    state.activeSidebarView = nextView;
    state.sidebarVisible = true;
  }
  applyUiState();
}

// The Browser edge is always draggable on desktop; the sidebar and bottom
// panel handles follow the layout lock.
function startResize(kind, event) {
  if (kind !== "browser" && !state.resizeEnabled) {
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
  // Capture keeps pointermove flowing while the pointer crosses the Browser iframe.
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch (error) {
    // Older browsers without pointer capture still get window-level moves.
  }
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", stopResize, { once: true });
  window.addEventListener("pointercancel", stopResize, { once: true });
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
    state.bottomPanelPinned = true;
    autosizeComposer();
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
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
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
  elements.targetBackend.addEventListener("change", () => syncTargetBackendFormState({ swapSocketPattern: true }));

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

  elements.showLayoutsViewBtn.addEventListener("click", () => {
    setSidebarView("layouts");
  });

  elements.showBrowserViewBtn.addEventListener("click", () => {
    setSidebarView("browser");
    if (state.sidebarVisible && state.previewUrl && !state.previewVisible) {
      reopenPreview().catch((error) => setPreviewStatus(error.message, "danger"));
    }
  });

  elements.mobileBrowserListBtn.addEventListener("click", () => {
    setMobileScreen("reports");
  });

  elements.mobileReportsBtn.addEventListener("click", () => {
    setMobileScreen("reports");
  });

  elements.mobileBackFromBrowserListBtn.addEventListener("click", () => {
    handleMobileBack(state.flatWindows.length ? "sessions" : "connect");
  });

  elements.reloadReportsBtn.addEventListener("click", async () => {
    await loadReports();
    setStatus("Reports reloaded.", "neutral");
  });

  elements.reportOpenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = elements.reportUrlInput.value.trim();
    if (!value) {
      elements.reportUrlInput.focus();
      return;
    }
    try {
      await loadUrlPreview(value, { history: "reset" });
      elements.reportUrlInput.value = "";
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
  });

  elements.reportList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-report-action]");
    const row = event.target.closest("[data-report-id]");
    if (!button || !row) {
      return;
    }
    const reportId = row.dataset.reportId;
    try {
      if (button.dataset.reportAction === "open") {
        await openReport(reportId);
      } else if (button.dataset.reportAction === "pin") {
        await toggleReportPin(reportId);
      } else if (button.dataset.reportAction === "delete") {
        await deleteReport(reportId);
      }
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.saveLayoutBtn.addEventListener("click", () => {
    openLayoutSaveForm();
  });

  elements.mobileLayoutsBtn.addEventListener("click", () => {
    setMobileScreen("layouts");
  });

  elements.mobileBackFromLayoutsBtn.addEventListener("click", () => {
    // Back to the explorer when a target is connected, otherwise to Connect.
    handleMobileBack(state.flatWindows.length ? "sessions" : "connect");
  });

  elements.reloadLayoutsBtn.addEventListener("click", async () => {
    await loadLayouts({ adoptActive: true });
    setStatus("Layouts reloaded.", "neutral");
  });

  elements.layoutSaveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.layoutNameInput.value.trim();
    if (!name) {
      elements.layoutNameInput.focus();
      return;
    }
    try {
      const layout = await saveLayoutAs(name);
      if (layout) {
        elements.layoutNameInput.value = "";
      }
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.layoutList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-layout-action]");
    const row = event.target.closest("[data-layout-id]");
    if (!button || !row) {
      return;
    }
    const layoutId = row.dataset.layoutId;
    try {
      if (layoutId === SCRATCH_LAYOUT_ID) {
        if (button.dataset.layoutAction === "load") {
          await activateScratchLayout();
        }
      } else if (button.dataset.layoutAction === "load") {
        await applyLayout(layoutId);
      } else if (button.dataset.layoutAction === "duplicate") {
        await duplicateLayout(layoutId);
      } else if (button.dataset.layoutAction === "delete") {
        await deleteLayout(layoutId);
      }
    } catch (error) {
      setStatus(error.message, "danger");
    }
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

  // The phone copies of the appearance controls drive the top-bar originals.
  elements.decreaseFontBtnMobile?.addEventListener("click", () => elements.decreaseFontBtn.click());
  elements.increaseFontBtnMobile?.addEventListener("click", () => elements.increaseFontBtn.click());
  elements.themeSelectMobile?.addEventListener("change", () => {
    elements.themeSelect.value = elements.themeSelectMobile.value;
    elements.themeSelect.dispatchEvent(new Event("change"));
  });
  elements.themeSelect.addEventListener("change", () => {
    const nextTheme = elements.themeSelect.value;
    state.uiTheme = THEME_SET.has(nextTheme) ? nextTheme : "dark";
    applyUiState();
  });

  elements.resizeToggle.addEventListener("click", () => {
    state.resizeEnabled = !state.resizeEnabled;
    applyUiState();
  });

  elements.latestOutputBtn.addEventListener("click", () => {
    jumpToLatestOutput().catch((error) => setStatus(error.message, "danger"));
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
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
    } catch (error) {
      setTargetHealth("Refresh failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.reloadSessionTreeBtn.addEventListener("click", async () => {
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
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
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
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
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
    } catch (error) {
      setTargetHealth("Switch failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.sidebarResizeHandle.addEventListener("pointerdown", (event) => startResize("sidebar", event));
  elements.panelResizeHandle.addEventListener("pointerdown", (event) => startResize("panel", event));
  elements.panelResizeHandle.addEventListener("dblclick", () => {
    state.bottomPanelPinned = false;
    applyUiState();
  });
  elements.browserResizeHandle.addEventListener("pointerdown", (event) => startResize("browser", event));
  elements.sessionTree.addEventListener("click", (event) => {
    handleSessionCloseClick(event).catch((error) => setStatus(error.message, "danger"));
  });
  elements.sessionTree.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest?.("[data-close-kind]")) {
      handleSessionCloseClick(event).catch((error) => setStatus(error.message, "danger"));
    }
  });
  elements.sessionTree.addEventListener("pointerdown", handleSessionPointerDown);
  elements.sessionTree.addEventListener("pointerup", (event) => {
    handleSessionPointerUp(event).catch((error) => setStatus(error.message, "danger"));
  });
  elements.sessionTree.addEventListener("pointercancel", () => {
    sessionPointerStart = null;
  });

  bindOutputElement(originalScreenOutput);

  elements.closePreviewBtn.addEventListener("click", closePreview);
  elements.mobileBrowserBackBtn.addEventListener("click", closePreview);
  elements.pinBrowserBtn.addEventListener("click", toggleBrowserPin);
  attachBrowserHandle();
  elements.browserBackBtn.addEventListener("click", () => {
    goBackPreview().catch((error) => setPreviewStatus(error.message, "danger"));
  });
  elements.browserForwardBtn.addEventListener("click", () => {
    goForwardPreview().catch((error) => setPreviewStatus(error.message, "danger"));
  });
  elements.browserHistorySelect.addEventListener("change", () => {
    jumpPreviewHistory(elements.browserHistorySelect.value).catch((error) => setPreviewStatus(error.message, "danger"));
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
  document.addEventListener("pointerdown", (event) => {
    if (!elements.specialKeyMenu.contains(event.target)) {
      closeSpecialKeyMenu();
    }
    if (!elements.editorMenu.contains(event.target)) {
      closeEditorMenu();
    }
  });
  elements.editorMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleEditorMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.editorMenuPopover.hidden) {
      closeEditorMenu();
    }
    if (event.key === "Escape" && !elements.specialKeyMenuPopover.hidden) {
      closeSpecialKeyMenu();
      elements.specialKeyMenuBtn.focus();
    }
  });
  window.addEventListener("message", handleBrowserMessage);

  elements.specialKeyMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSpecialKeyMenu();
  });

  elements.specialKeyMenuPopover.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-special-key-id]");
    if (!button || state.composerSending) {
      return;
    }

    const item = COMPOSER_UTILS.getSpecialKeyById(button.dataset.specialKeyId);
    if (!item) {
      return;
    }

    try {
      closeSpecialKeyMenu();
      await sendComposerKey(item.keys || item.key, item.repeat || 1);
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await sendComposerShortcut();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendRawTextBtn.addEventListener("click", async () => {
    try {
      await sendComposerPayload({ appendNewline: false });
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

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

  elements.sendTextInput.addEventListener("input", autosizeComposer);
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
    const passthroughKey = COMPOSER_UTILS.getPassthroughKeyOnKeydown(event, elements.sendTextInput.value);
    if (passthroughKey) {
      event.preventDefault();
      try {
        await sendKey(passthroughKey);
      } catch (error) {
        setStatus(error.message, "danger");
      }
      return;
    }

    if (COMPOSER_UTILS.shouldSendWithoutEnterOnKeydown(event)) {
      event.preventDefault();
      try {
        await sendComposerPayload({ appendNewline: false });
      } catch (error) {
        setStatus(error.message, "danger");
      }
      return;
    }

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

  elements.autoFitToggle.addEventListener("change", () => {
    state.autoFitPane = elements.autoFitToggle.checked;
    saveUiPreferences();
    if (state.autoFitPane) {
      scheduleAutoFit();
    }
  });

  elements.fitPaneBtn.addEventListener("click", async () => {
    closeEditorMenu();
    try {
      await fitPaneToScreen({ force: true });
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.zoomPaneBtn.addEventListener("click", async () => {
    closeEditorMenu();
    if (!state.selectedTargetId || !hasSelectedWindow() || state.sessionBackend !== "tmux") {
      setStatus("Pane zoom is only available for tmux targets.", "warning");
      return;
    }
    try {
      const result = await apiFetch("/api/toggle-zoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: state.selectedTargetId,
          socket: state.selectedSocket || "",
          windowId: state.selectedWindowId
        })
      });
      setStatus(result.zoomed ? `Pane #${state.selectedWindowId} zoomed.` : "Window unzoomed; split layout restored.", "neutral");
      await loadSessions();
      await refreshScreen({ force: true });
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  // Toolbar splits act on the highlighted view; each view's header has its own.
  elements.splitRightBtn.addEventListener("click", () => {
    splitActivePane("horizontal").catch((error) => setStatus(error.message, "danger"));
  });
  elements.splitDownBtn.addEventListener("click", () => {
    splitActivePane("vertical").catch((error) => setStatus(error.message, "danger"));
  });
  elements.paneTree.addEventListener("click", handlePaneTreeClick);
  elements.paneTree.addEventListener("pointerdown", handleDividerPointerDown);

  window.addEventListener("resize", () => {
    document.documentElement.style.setProperty("--sidebar-width", `${getEffectiveSidebarWidth()}px`);
    document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
    if (paneTreeMobileMode !== null && paneTreeMobileMode !== isMobileViewport()) {
      renderPaneTree();
    }
    scheduleAutoFit();
  });
  // Sidebar, browser drawer and bottom panel drags change the output box without a window resize.
  if (typeof ResizeObserver === "function") {
    outputResizeObserver = new ResizeObserver(() => scheduleAutoFit());
    outputResizeObserver.observe(elements.screenOutput);
  }
  window.addEventListener("popstate", handleMobileHistoryChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

async function bootAuthenticatedWorkspace() {
  await loadTargets();
  renderPaneTree();
  loadLayouts({ adoptActive: true }).catch((error) => setStatus(error.message, "danger"));
  loadReports();
  state.mobileScreen = "connect";
  resetMobileStack("connect");
  if (isMobileViewport()) {
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  }
  if (state.previewVisible && state.previewUrl) {
    await refreshPreviewAccessToken();
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
  resetMobileStack(state.mobileScreen);
  renderSpecialKeyMenu();
  attachEvents();
  attachWheelContainment();
  loadPaneLayout();
  renderPaneTree();

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
