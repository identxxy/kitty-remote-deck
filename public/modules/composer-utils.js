(function attachComposerUtils(global) {
  const SPECIAL_KEY_GROUPS = [
    {
      // Shift+Left answers Codex questions; Shift+Tab cycles Claude Code's permission modes.
      label: "Agent",
      keys: [
        { id: "shift-left", label: "Shift+←", key: "shift+left" },
        { id: "alt-up", label: "Alt+↑", key: "alt+up" },
        { id: "shift-tab", label: "Shift+Tab", key: "shift+tab" }
      ]
    },
    {
      label: "Interrupt",
      keys: [
        { id: "escape", label: "Esc", key: "escape" },
        { id: "tab", label: "Tab", key: "tab" },
        { id: "ctrl-c", label: "Ctrl+C", key: "ctrl+c" },
        { id: "ctrl-d", label: "Ctrl+D", key: "ctrl+d" },
        // Claude Code exits on a second Ctrl+D within a short window; send both at once.
        { id: "ctrl-d-twice", label: "Ctrl+D ×2", key: "ctrl+d", repeat: 2 }
      ]
    },
    {
      label: "Line editing",
      keys: [
        { id: "backspace", label: "Backspace", key: "backspace" },
        { id: "delete", label: "Delete", key: "delete" },
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
    return event.key === "Enter" && !event.shiftKey && !event.altKey && !event.isComposing;
  }

  // Alt+Enter types the composer text into the pane without pressing Enter,
  // for filling a prompt that the user will finish by hand.
  function shouldSendWithoutEnterOnKeydown(event) {
    return event.key === "Enter" && event.altKey && !event.shiftKey && !event.isComposing;
  }

  const api = {
    SPECIAL_KEY_GROUPS,
    flattenSpecialKeys,
    getSpecialKeyById,
    getEnterAction,
    shouldSendWithoutEnterOnKeydown,
    shouldSubmitOnKeydown
  };

  global.KRDComposerUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
