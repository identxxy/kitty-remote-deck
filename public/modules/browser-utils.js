(function attachBrowserUtils(global) {
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

  function linkifyTerminalText(text) {
    const pattern = /\b(?:https?:\/\/|file:\/\/)[^\s<>"']+/gi;
    let cursor = 0;
    let html = "";

    for (const match of String(text).matchAll(pattern)) {
      const rawUrl = match[0];
      const start = match.index || 0;
      const { clean, trailing } = trimUrlPunctuation(rawUrl);

      html += escapeHtml(String(text).slice(cursor, start));
      html += `<a class="terminal-link" href="${escapeAttribute(clean)}" data-preview-url="${escapeAttribute(clean)}">${escapeHtml(clean)}</a>`;
      html += escapeHtml(trailing);
      cursor = start + rawUrl.length;
    }

    html += escapeHtml(String(text).slice(cursor));
    return html;
  }

  function createPreviewResourceUrl(url, targetId) {
    const params = new URLSearchParams({
      targetId,
      url
    });
    return `/api/url-resource?${params.toString()}`;
  }

  function normalizeBrowserUrl(rawUrl) {
    const value = String(rawUrl || "").trim();

    if (!value) {
      throw new Error("URL is empty.");
    }

    const schemeMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch) {
      if (/^[A-Za-z0-9.-]+:\d+(?:[/?#].*)?$/.test(value)) {
        return new URL(`https://${value}`).href;
      }

      const parsed = new URL(value);
      if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
        throw new Error("Only http://, https://, and file:// URLs are supported.");
      }
      return parsed.href;
    }

    if (value.startsWith("/")) {
      return new URL(`file://${value}`).href;
    }

    return new URL(`https://${value}`).href;
  }

  global.KRDBrowserUtils = {
    createPreviewResourceUrl,
    escapeAttribute,
    escapeHtml,
    linkifyTerminalText,
    normalizeBrowserUrl,
    trimUrlPunctuation
  };
})(window);
