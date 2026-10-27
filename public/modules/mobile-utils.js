(function attachMobileUtils(global) {
  function isMobileViewport() {
    return global.matchMedia("(max-width: 720px)").matches;
  }

  // Phone screens form a stack; every screen change is a push and every
  // "back" (in-page button, swipe, hardware key) is a pop. Pushing a screen
  // that is already on the stack returns to it instead of nesting deeper.
  function pushScreen(stack, screen) {
    const index = stack.indexOf(screen);
    return index >= 0 ? stack.slice(0, index + 1) : [...stack, screen];
  }

  function popScreen(stack) {
    return stack.length > 1 ? stack.slice(0, -1) : stack.slice();
  }

  function replaceTop(stack, screen) {
    const index = stack.indexOf(screen);
    if (index >= 0 && index < stack.length - 1) {
      return stack.slice(0, index + 1);
    }
    return [...stack.slice(0, -1), screen];
  }

  // History entry i mirrors stack[i]. A popstate entry from this page load
  // ("nonce" matches) selects a depth; anything else is foreign and resets
  // the stack to its base.
  function stackForHistoryEntry({ stack, entry, key, nonce, allowedScreens }) {
    const screen = entry?.[key];
    const index = entry?.krdIndex;
    if (entry?.krdNonce !== nonce || !allowedScreens.has(screen) || !Number.isInteger(index) || index < 0) {
      return { stack: [stack[0]], screen: stack[0], foreign: true };
    }
    if (index < stack.length) {
      const next = stack.slice(0, index + 1);
      next[index] = screen;
      return { stack: next, screen, foreign: false };
    }
    // Forward past the top (swipe forward): nest without truncating.
    return { stack: [...stack, screen], screen, foreign: false };
  }

  global.KRDMobileUtils = {
    isMobileViewport,
    popScreen,
    pushScreen,
    replaceTop,
    stackForHistoryEntry
  };
})(window);
