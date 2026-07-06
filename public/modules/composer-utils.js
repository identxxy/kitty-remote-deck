(function attachComposerUtils(global) {
  const SPECIAL_KEY_GROUPS = [
    {
      label: "Interrupt",
      keys: [
        { id: "escape", label: "Esc", key: "escape" },
        { id: "tab", label: "Tab", key: "tab" },
        { id: "ctrl-c", label: "Ctrl+C", key: "ctrl+c" },
        { id: "ctrl-d", label: "Ctrl+D", key: "ctrl+d" }
      ]
    },
    {
      label: "Line editing",
      keys: [
        { id: "ctrl-a", label: "Ctrl+A", key: "ctrl+a" },
        { id: "ctrl-e", label: "Ctrl+E", key: "ctrl+e" },
        { id: "ctrl-k", label: "Ctrl+K", key: "ctrl+k" },
        { id: "ctrl-l", label: "Ctrl+L", key: "ctrl+l" },
        { id: "ctrl-u", label: "Ctrl+U", key: "ctrl+u" },
        { id: "ctrl-w", label: "Ctrl+W", key: "ctrl+w" }
      ]
    },
    {
      label: "Navigation",
      keys: [
        { id: "arrow-up", label: "↑", key: "up" },
        { id: "arrow-down", label: "↓", key: "down" },
        { id: "arrow-left", label: "←", key: "left" },
        { id: "arrow-right", label: "→", key: "right" },
        { id: "home", label: "Home", key: "home" },
        { id: "end", label: "End", key: "end" }
      ]
    }
  ];

  function flattenSpecialKeys(groups = SPECIAL_KEY_GROUPS) {
    return groups.flatMap((group) => group.keys.map((item) => ({ ...item, group: group.label })));
  }

  function getSpecialKeyById(id) {
    return flattenSpecialKeys().find((item) => item.id === id) || null;
  }

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

  const api = {
    SPECIAL_KEY_GROUPS,
    flattenSpecialKeys,
    getSpecialKeyById,
    getEnterAction,
    shouldSubmitOnKeydown
  };

  global.KRDComposerUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
