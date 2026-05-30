(function attachComposerUtils(global) {
  function getEnterAction(text, options = {}) {
    if (options.hasImage) {
      return { type: "send-composer", appendNewline: true };
    }

    return String(text || "").length > 0
      ? { type: "send-text", appendNewline: true }
      : { type: "send-key", key: "enter" };
  }

  function shouldSubmitOnKeydown(event) {
    return event.key === "Enter" && !event.shiftKey && !event.isComposing;
  }

  global.KRDComposerUtils = {
    getEnterAction,
    shouldSubmitOnKeydown
  };
})(window);
