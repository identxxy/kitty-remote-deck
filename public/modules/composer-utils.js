(function attachComposerUtils(global) {
  // Grouped by the program that reads the key. Claude Code bindings follow its
  // default keymap (2.1.x); Codex ones follow codex-rs/tui keymap.rs (0.163).
  // `keys` sends a chord in one round trip; `repeat` sends one key N times.
  const SPECIAL_KEY_GROUPS = [
    {
      label: "Claude Code",
      keys: [
        { id: "claude-shift-tab", label: "Shift+Tab", hint: "Cycle permission mode", key: "shift+tab" },
        { id: "claude-esc-esc", label: "Esc Esc", hint: "Rewind menu (empty prompt)", key: "escape", repeat: 2 },
        { id: "claude-ctrl-b", label: "Ctrl+B", hint: "Background the running task", key: "ctrl+b" },
        { id: "claude-send-now", label: "Ctrl+X Ctrl+S", hint: "Send queued messages now", keys: ["ctrl+x", "ctrl+s"] },
        { id: "claude-ctrl-t", label: "Ctrl+T", hint: "Toggle task checklist", key: "ctrl+t" },
        { id: "claude-ctrl-o", label: "Ctrl+O", hint: "Toggle transcript", key: "ctrl+o" },
        { id: "claude-ctrl-r", label: "Ctrl+R", hint: "Search prompt history", key: "ctrl+r" },
        { id: "claude-alt-p", label: "Alt+P", hint: "Switch model", key: "alt+p" },
        { id: "claude-alt-o", label: "Alt+O", hint: "Toggle fast mode", key: "alt+o" },
        { id: "claude-kill-agents", label: "Ctrl+X Ctrl+K", hint: "Stop background subagents (press twice)", keys: ["ctrl+x", "ctrl+k"] }
      ]
    },
    {
      label: "Codex",
      keys: [
        { id: "codex-shift-tab", label: "Shift+Tab", hint: "Cycle collaboration mode", key: "shift+tab" },
        { id: "codex-esc-esc", label: "Esc Esc", hint: "Edit previous message (empty prompt)", key: "escape", repeat: 2 },
        { id: "codex-tab", label: "Tab", hint: "Queue the typed draft", key: "tab" },
        { id: "codex-shift-left", label: "Shift+←", hint: "Next question / edit queued", key: "shift+left" },
        { id: "codex-shift-right", label: "Shift+→", hint: "Back toward the prompt", key: "shift+right" },
        { id: "codex-ctrl-bracket", label: "Ctrl+]", hint: "Skip the question", key: "ctrl+]" },
        { id: "codex-shift-up", label: "Shift+↑", hint: "Reasoning effort +", key: "shift+up" },
        { id: "codex-shift-down", label: "Shift+↓", hint: "Reasoning effort −", key: "shift+down" },
        { id: "codex-ctrl-t", label: "Ctrl+T", hint: "Toggle transcript", key: "ctrl+t" },
        { id: "codex-ctrl-r", label: "Ctrl+R", hint: "Search prompt history", key: "ctrl+r" },
        { id: "codex-alt-left", label: "Alt+←", hint: "Previous agent", key: "alt+left" },
        { id: "codex-alt-right", label: "Alt+→", hint: "Next agent", key: "alt+right" },
        { id: "codex-approve", label: "y", hint: "Approve", key: "y" },
        { id: "codex-approve-session", label: "a", hint: "Approve for session", key: "a" },
        { id: "codex-decline", label: "n", hint: "Decline", key: "n" }
      ]
    },
    {
      label: "Terminal",
      keys: [
        { id: "escape", label: "Esc", hint: "Interrupt / cancel", key: "escape" },
        { id: "tab", label: "Tab", hint: "Autocomplete", key: "tab" },
        { id: "ctrl-c", label: "Ctrl+C", hint: "Interrupt", key: "ctrl+c" },
        { id: "ctrl-d", label: "Ctrl+D", hint: "EOF", key: "ctrl+d" },
        // Claude Code exits on a second Ctrl+D within a short window; send both at once.
        { id: "ctrl-d-twice", label: "Ctrl+D ×2", hint: "Exit Claude Code", key: "ctrl+d", repeat: 2 },
        { id: "ctrl-z", label: "Ctrl+Z", hint: "Suspend", key: "ctrl+z" },
        { id: "ctrl-l", label: "Ctrl+L", hint: "Clear screen", key: "ctrl+l" }
      ]
    },
    {
      label: "Line editing",
      keys: [
        { id: "backspace", label: "Backspace", key: "backspace" },
        { id: "delete", label: "Delete", key: "delete" },
        { id: "ctrl-a", label: "Ctrl+A", hint: "Line start", key: "ctrl+a" },
        { id: "ctrl-e", label: "Ctrl+E", hint: "Line end", key: "ctrl+e" },
        { id: "ctrl-k", label: "Ctrl+K", hint: "Kill to line end", key: "ctrl+k" },
        { id: "ctrl-u", label: "Ctrl+U", hint: "Kill to line start", key: "ctrl+u" },
        { id: "ctrl-w", label: "Ctrl+W", hint: "Delete previous word", key: "ctrl+w" },
        { id: "ctrl-y", label: "Ctrl+Y", hint: "Paste deleted text", key: "ctrl+y" }
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
        { id: "end", label: "End", key: "end" },
        { id: "page-up", label: "PgUp", key: "page_up" },
        { id: "page-down", label: "PgDn", key: "page_down" }
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

  const PASSTHROUGH_KEYS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Escape: "escape"
  };

  // With nothing typed, the arrow keys have no text to move through and Esc has
  // nothing to cancel, so they go to the pane instead: menu navigation, prompt
  // history, and interrupting the agent.
  function getPassthroughKeyOnKeydown(event, text) {
    if (String(text || "").length > 0 || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return null;
    }
    return PASSTHROUGH_KEYS[event.key] || null;
  }

  const api = {
    SPECIAL_KEY_GROUPS,
    getPassthroughKeyOnKeydown,
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
