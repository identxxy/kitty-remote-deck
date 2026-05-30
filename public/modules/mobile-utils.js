(function attachMobileUtils(global) {
  function isMobileViewport() {
    return global.matchMedia("(max-width: 720px)").matches;
  }

  function getHistoryScreen(historyState, key, allowedScreens) {
    const screen = historyState?.[key];
    return allowedScreens.has(screen) ? screen : "";
  }

  function syncHistory({ screen, mode = "push", key, allowedScreens, historyObject, href }) {
    const nextScreen = allowedScreens.has(screen) ? screen : "connect";
    const currentScreen = getHistoryScreen(historyObject.state, key, allowedScreens);
    const nextState = {
      ...(historyObject.state || {}),
      [key]: nextScreen
    };

    if (mode === "replace" || !currentScreen) {
      historyObject.replaceState(nextState, "", href);
      return;
    }

    if (currentScreen !== nextScreen) {
      historyObject.pushState(nextState, "", href);
    }
  }

  global.KRDMobileUtils = {
    getHistoryScreen,
    isMobileViewport,
    syncHistory
  };
})(window);
