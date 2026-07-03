(function attachAnsiUtils(global) {
  const BASIC_FOREGROUND = {
    30: "#000000",
    31: "#cd3131",
    32: "#00bc00",
    33: "#949800",
    34: "#0451a5",
    35: "#bc05bc",
    36: "#0598bc",
    37: "#cccccc",
    90: "#666666",
    91: "#f14c4c",
    92: "#23d18b",
    93: "#f5f543",
    94: "#3b8eea",
    95: "#d670d6",
    96: "#29b8db",
    97: "#ffffff"
  };

  const BASIC_BACKGROUND = {
    40: BASIC_FOREGROUND[30],
    41: BASIC_FOREGROUND[31],
    42: BASIC_FOREGROUND[32],
    43: BASIC_FOREGROUND[33],
    44: BASIC_FOREGROUND[34],
    45: BASIC_FOREGROUND[35],
    46: BASIC_FOREGROUND[36],
    47: BASIC_FOREGROUND[37],
    100: BASIC_FOREGROUND[90],
    101: BASIC_FOREGROUND[91],
    102: BASIC_FOREGROUND[92],
    103: BASIC_FOREGROUND[93],
    104: BASIC_FOREGROUND[94],
    105: BASIC_FOREGROUND[95],
    106: BASIC_FOREGROUND[96],
    107: BASIC_FOREGROUND[97]
  };

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttribute(text) {
    return escapeHtml(text).replace(/'/g, "&#39;");
  }

  function trimUrlPunctuation(url) {
    let clean = url;
    let trailing = "";

    while (/[.,;!?)]$/.test(clean)) {
      trailing = clean.slice(-1) + trailing;
      clean = clean.slice(0, -1);
    }

    return { clean, trailing };
  }

  function clampByte(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.min(255, Math.round(number)));
  }

  function toHex(value) {
    return clampByte(value).toString(16).padStart(2, "0");
  }

  function rgbToHex(red, green, blue) {
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  }

  function color256ToHex(value) {
    const color = clampByte(value);
    if (color < 16) {
      return BASIC_FOREGROUND[color < 8 ? 30 + color : 90 + color - 8] || BASIC_FOREGROUND[37];
    }

    if (color < 232) {
      const level = [0, 95, 135, 175, 215, 255];
      const offset = color - 16;
      const red = level[Math.floor(offset / 36) % 6];
      const green = level[Math.floor(offset / 6) % 6];
      const blue = level[offset % 6];
      return rgbToHex(red, green, blue);
    }

    const gray = 8 + (color - 232) * 10;
    return rgbToHex(gray, gray, gray);
  }

  function createState() {
    return {
      foreground: "",
      background: "",
      bold: false,
      dim: false,
      italic: false,
      underline: false,
      inverse: false
    };
  }

  function resetState(state) {
    Object.assign(state, createState());
  }

  function parseSgrParams(rawParams) {
    const value = String(rawParams || "");
    if (!value) {
      return [0];
    }

    return value
      .replace(/:/g, ";")
      .split(";")
      .map((part) => (part === "" ? 0 : Number(part)))
      .map((number) => (Number.isFinite(number) ? number : 0));
  }

  function readExtendedColor(params, index) {
    const mode = params[index + 1];
    if (mode === 5) {
      return {
        color: color256ToHex(params[index + 2]),
        nextIndex: index + 2
      };
    }

    if (mode === 2) {
      return {
        color: rgbToHex(params[index + 2], params[index + 3], params[index + 4]),
        nextIndex: index + 4
      };
    }

    return {
      color: "",
      nextIndex: index
    };
  }

  function applySgrParams(state, params) {
    for (let index = 0; index < params.length; index += 1) {
      const code = params[index];

      if (code === 0) {
        resetState(state);
      } else if (code === 1) {
        state.bold = true;
        state.dim = false;
      } else if (code === 2) {
        state.dim = true;
        state.bold = false;
      } else if (code === 3) {
        state.italic = true;
      } else if (code === 4) {
        state.underline = true;
      } else if (code === 7) {
        state.inverse = true;
      } else if (code === 22) {
        state.bold = false;
        state.dim = false;
      } else if (code === 23) {
        state.italic = false;
      } else if (code === 24) {
        state.underline = false;
      } else if (code === 27) {
        state.inverse = false;
      } else if (code === 39) {
        state.foreground = "";
      } else if (code === 49) {
        state.background = "";
      } else if (BASIC_FOREGROUND[code]) {
        state.foreground = BASIC_FOREGROUND[code];
      } else if (BASIC_BACKGROUND[code]) {
        state.background = BASIC_BACKGROUND[code];
      } else if (code === 38 || code === 48) {
        const result = readExtendedColor(params, index);
        if (result.color && code === 38) {
          state.foreground = result.color;
        } else if (result.color && code === 48) {
          state.background = result.color;
        }
        index = result.nextIndex;
      }
    }
  }

  function styleForState(state) {
    const foreground = state.inverse ? state.background || "var(--editor-bg)" : state.foreground;
    const background = state.inverse ? state.foreground || "var(--text)" : state.background;
    const styles = [];

    if (foreground) {
      styles.push(`color: ${foreground}`);
    }
    if (background) {
      styles.push(`background-color: ${background}`);
    }
    if (state.bold) {
      styles.push("font-weight: 700");
    }
    if (state.dim) {
      styles.push("opacity: 0.72");
    }
    if (state.italic) {
      styles.push("font-style: italic");
    }
    if (state.underline) {
      styles.push("text-decoration: underline");
    }

    return styles.join("; ");
  }

  function renderTextRun(text, style, hyperlink = "") {
    if (hyperlink) {
      return renderTerminalLink(hyperlink, style, text);
    }

    const pattern = /\b(?:https?:\/\/|file:\/\/)[^\s<>"']+/gi;
    let cursor = 0;
    let html = "";

    for (const match of String(text).matchAll(pattern)) {
      const rawUrl = match[0];
      const start = match.index || 0;
      const { clean, trailing } = trimUrlPunctuation(rawUrl);

      html += renderStyledText(String(text).slice(cursor, start), style);
      html += renderTerminalLink(clean, style);
      html += renderStyledText(trailing, style);
      cursor = start + rawUrl.length;
    }

    html += renderStyledText(String(text).slice(cursor), style);
    return html;
  }

  function renderStyledText(text, style) {
    if (!text) {
      return "";
    }

    const escaped = escapeHtml(text);
    return style ? `<span style="${escapeAttribute(style)}">${escaped}</span>` : escaped;
  }

  function renderTerminalLink(url, style, label = url) {
    if (!label) {
      return "";
    }

    const styleAttribute = style ? ` style="${escapeAttribute(style)}"` : "";
    return `<a class="terminal-link" href="${escapeAttribute(url)}" data-preview-url="${escapeAttribute(url)}"${styleAttribute}>${escapeHtml(label)}</a>`;
  }

  function renderAnsiTerminalText(text) {
    const value = String(text || "");
    const state = createState();
    const pattern = /\x1b\]8;[^\x07\x1b;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b\[([0-9;:]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;
    let cursor = 0;
    let html = "";
    let hyperlink = "";
    let match;

    while ((match = pattern.exec(value)) !== null) {
      html += renderTextRun(value.slice(cursor, match.index), styleForState(state), hyperlink);

      if (typeof match[1] === "string") {
        hyperlink = match[1];
      } else if (typeof match[2] === "string") {
        applySgrParams(state, parseSgrParams(match[2]));
      }

      cursor = match.index + match[0].length;
    }

    html += renderTextRun(value.slice(cursor), styleForState(state), hyperlink);
    return html;
  }

  const api = {
    color256ToHex,
    renderAnsiTerminalText
  };

  global.KRDAnsiUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
