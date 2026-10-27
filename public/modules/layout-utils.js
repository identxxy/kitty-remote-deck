// A layout as the client stores and sends it: pane tree, active view and the
// pinned Browser. Shared by the page and the unit tests.
(function attachLayoutUtils(global) {
  const paneTree = typeof module !== "undefined" && module.exports ? require("./pane-tree") : global.KRDPaneTree;

  function normalizeBrowserState(raw) {
    if (!raw || typeof raw.url !== "string" || !raw.url) {
      return null;
    }
    return { url: raw.url, targetId: typeof raw.targetId === "string" ? raw.targetId : "" };
  }

  function decodeLayoutPayload(raw) {
    if (!raw) {
      return null;
    }
    const decoded = paneTree.decodePersistedPaneLayout({ paneVersion: 1, paneRoot: raw.paneRoot, activePaneId: raw.activePaneId });
    if (!decoded.paneRoot) {
      return null;
    }
    return { paneRoot: decoded.paneRoot, activePaneId: decoded.activePaneId, browser: normalizeBrowserState(raw.browser) };
  }

  const api = { normalizeBrowserState, decodeLayoutPayload };
  global.KRDLayoutUtils = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
