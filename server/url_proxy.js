const PROXY_PATH = "/api/url-resource";
const REWRITABLE_ATTRS = new Set([
  "action",
  "href",
  "poster",
  "src"
]);

function htmlEscapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function scriptJson(value) {
  return JSON.stringify(String(value || ""))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function isProxyableScheme(url) {
  return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:";
}

function createBrowserBridgeScript(finalUrl, targetId) {
  return `<script data-krd-browser-bridge>
(function () {
  var finalUrl = ${scriptJson(finalUrl)};
  var targetId = ${scriptJson(targetId)};

  function toTargetUrl(href) {
    if (!href || String(href).trim().charAt(0) === "#") {
      return "";
    }
    try {
      var resolved = new URL(href, window.location.href);
      if (resolved.pathname === "${PROXY_PATH}" && resolved.searchParams.has("url")) {
        return resolved.searchParams.get("url") || "";
      }
    } catch (error) {}
    try {
      var targetResolved = new URL(href, finalUrl);
      if (/^(https?|file):$/i.test(targetResolved.protocol)) {
        return targetResolved.href;
      }
    } catch (nestedError) {}
    return "";
  }

  function post(type, url) {
    if (!url) {
      return;
    }
    window.parent.postMessage({
      source: "kitty-remote-deck-browser",
      type: type,
      targetId: targetId,
      url: url
    }, "*");
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) {
      return;
    }
    var url = toTargetUrl(link.getAttribute("href") || link.href);
    if (!url) {
      return;
    }
    event.preventDefault();
    post("browser:navigate", url);
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.tagName || form.tagName.toLowerCase() !== "form") {
      return;
    }
    var method = (form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") {
      return;
    }
    var action = form.getAttribute("action") || finalUrl || window.location.href;
    var targetUrl = toTargetUrl(action);
    if (!targetUrl) {
      return;
    }
    try {
      var next = new URL(targetUrl);
      var data = new FormData(form);
      data.forEach(function (value, key) {
        next.searchParams.append(key, value);
      });
      event.preventDefault();
      post("browser:navigate", next.href);
    } catch (error) {}
  }, true);

  post("browser:loaded", finalUrl);
})();
</script>`;
}

function injectBrowserBridge(html, finalUrl, targetId) {
  const script = createBrowserBridgeScript(finalUrl, targetId);
  const value = String(html);

  if (/<\/body\s*>/i.test(value)) {
    return value.replace(/<\/body\s*>/i, `${script}</body>`);
  }

  if (/<\/head\s*>/i.test(value)) {
    return value.replace(/<\/head\s*>/i, `${script}</head>`);
  }

  return `${value}${script}`;
}

function resolveResourceUrl(baseUrl, candidate) {
  const value = String(candidate || "").trim();

  if (!value || value.startsWith("#")) {
    return "";
  }

  if (/^(?:data|blob|mailto|tel|javascript):/i.test(value)) {
    return "";
  }

  try {
    const resolved = new URL(value, baseUrl);
    return isProxyableScheme(resolved) ? resolved.href : "";
  } catch (error) {
    return "";
  }
}

function createProxyUrl(resourceUrl, targetId) {
  const params = new URLSearchParams({
    targetId: String(targetId || ""),
    url: String(resourceUrl || "")
  });
  return `${PROXY_PATH}?${params.toString()}`;
}

function rewriteSrcset(value, baseUrl, targetId) {
  return String(value)
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) {
        return trimmed;
      }
      const parts = trimmed.split(/\s+/);
      const resolved = resolveResourceUrl(baseUrl, parts[0]);
      if (!resolved) {
        return trimmed;
      }
      return [createProxyUrl(resolved, targetId), ...parts.slice(1)].join(" ");
    })
    .join(", ");
}

function rewriteCssResources(css, baseUrl, targetId) {
  return String(css).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, rawValue) => {
    const resolved = resolveResourceUrl(baseUrl, rawValue);
    if (!resolved) {
      return match;
    }
    return `url("${createProxyUrl(resolved, targetId)}")`;
  });
}

function rewriteStyleAttribute(value, baseUrl, targetId) {
  return rewriteCssResources(value, baseUrl, targetId);
}

function rewriteHtmlResources(html, baseUrl, targetId, options = {}) {
  const rewrittenAttrs = String(html).replace(
    /\s([a-zA-Z:-]+)\s*=\s*(["'])(.*?)\2/gs,
    (match, rawName, quote, rawValue) => {
      const name = rawName.toLowerCase();
      let nextValue = rawValue;

      if (REWRITABLE_ATTRS.has(name)) {
        const resolved = resolveResourceUrl(baseUrl, rawValue);
        if (resolved) {
          nextValue = createProxyUrl(resolved, targetId);
        }
      } else if (name === "srcset") {
        nextValue = rewriteSrcset(rawValue, baseUrl, targetId);
      } else if (name === "style") {
        nextValue = rewriteStyleAttribute(rawValue, baseUrl, targetId);
      }

      return ` ${rawName}=${quote}${htmlEscapeAttribute(nextValue)}${quote}`;
    }
  );

  const withoutRefresh = rewrittenAttrs.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])refresh\1[^>]*>/gi, "");
  if (options.injectBrowserBridge === false) {
    return withoutRefresh;
  }
  return injectBrowserBridge(withoutRefresh, options.finalUrl || baseUrl, targetId);
}

function contentTypeMainValue(contentType) {
  return String(contentType || "").split(";")[0].trim().toLowerCase();
}

function isHtmlContentType(contentType) {
  const type = contentTypeMainValue(contentType);
  return type === "text/html" || type === "application/xhtml+xml";
}

function isCssContentType(contentType) {
  return contentTypeMainValue(contentType) === "text/css";
}

function isTextLikeContentType(contentType) {
  const type = contentTypeMainValue(contentType);
  return (
    type.startsWith("text/") ||
    type === "application/javascript" ||
    type === "application/json" ||
    type === "application/xml" ||
    type === "image/svg+xml"
  );
}

module.exports = {
  createProxyUrl,
  createBrowserBridgeScript,
  isCssContentType,
  isHtmlContentType,
  isTextLikeContentType,
  resolveResourceUrl,
  rewriteCssResources,
  rewriteHtmlResources
};
