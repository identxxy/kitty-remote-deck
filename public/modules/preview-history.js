(function attachPreviewHistoryUtils(global) {
  const DEFAULT_LIMIT = 30;

  function createState(history = [], index = -1, url = "") {
    const items = Array.isArray(history)
      ? history.filter((item) => typeof item === "string" && item.trim())
      : [];
    const safeIndex = items.length
      ? Math.min(Math.max(Number.isFinite(index) ? index : items.length - 1, 0), items.length - 1)
      : -1;
    return {
      items,
      index: safeIndex,
      url: safeIndex >= 0 ? items[safeIndex] : String(url || "")
    };
  }

  function remember(state, url, mode = "push", limit = DEFAULT_LIMIT) {
    if (mode === "none") {
      return state;
    }

    if (mode === "reset") {
      return { items: [url], index: 0, url };
    }

    if (mode === "replace" && state.index >= 0) {
      const items = state.items.slice();
      items[state.index] = url;
      return { items, index: state.index, url };
    }

    if (state.items[state.index] === url) {
      return { ...state, url };
    }

    const nextItems = state.items.slice(0, state.index + 1);
    nextItems.push(url);
    const items = nextItems.slice(-limit);
    return {
      items,
      index: items.length - 1,
      url
    };
  }

  function replaceLoaded(state, url) {
    if (!url || url === state.url) {
      return state;
    }

    if (state.index >= 0) {
      const items = state.items.slice();
      items[state.index] = url;
      return { items, index: state.index, url };
    }

    return { items: [url], index: 0, url };
  }

  function canGoForward(state) {
    return state.index >= 0 && state.index < state.items.length - 1;
  }

  function goBack(state) {
    if (state.index <= 0) {
      return null;
    }

    const index = state.index - 1;
    return {
      items: state.items,
      index,
      url: state.items[index] || ""
    };
  }

  function goForward(state) {
    if (!canGoForward(state)) {
      return null;
    }

    const index = state.index + 1;
    return {
      items: state.items,
      index,
      url: state.items[index] || ""
    };
  }

  function jump(state, index) {
    const nextIndex = Number(index);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= state.items.length) {
      return null;
    }

    return {
      items: state.items,
      index: nextIndex,
      url: state.items[nextIndex] || ""
    };
  }

  global.KRDPreviewHistory = {
    canGoForward,
    createState,
    goBack,
    goForward,
    jump,
    remember,
    replaceLoaded
  };
})(window);
