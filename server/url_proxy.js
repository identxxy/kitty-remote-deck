// Rewrites proxied HTML/CSS so every reference keeps going through the deck,
// and builds the bridge script that keeps runtime requests on the same path.
//
// Proxy URLs are path-shaped so that relative references resolve in the
// browser without any rewriting at all:
//   /p/<targetId>/<access>/<scheme>/<host or ->/<path>?<query>
// A page at /p/t/tok/file/-/tmp/report/index.html that asks for "data.json"
// lands on /p/t/tok/file/-/tmp/report/data.json, whether the reference comes
// from markup, CSS, fetch(), an ES module import or a dynamically created
// element. The older query form (/api/url-resource?targetId=&url=) is still
// served for history entries that predate the path form.
const PROXY_PATH = "/api/url-resource";
const PROXY_PREFIX = "/p/";
const REWRITABLE_ATTRS = new Set([
  "action",
  "data",
  "href",
  "poster",
  "src",
  "xlink:href"
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

// Hosts the viewer's browser cannot reach on its own, so the target fetches
// them: loopback, RFC 1918, link-local, CGNAT/Tailscale, ULA IPv6, bare
// hostnames and the usual private suffixes.
const PRIVATE_SUFFIXES = [".local", ".localhost", ".lan", ".internal", ".home.arpa", ".ts.net", ".localdomain"];

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host === "0.0.0.0" || host === "::1") {
    return true;
  }
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  if (!host.includes(".") && !host.includes(":")) {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(":")) {
    return /^(fc|fd|fe[89ab])/i.test(host);
  }
  return false;
}

// file:// always goes through the target. http(s) goes through the target when
// the host is private or the same host the document came from; public hosts
// (CDNs) are loaded directly by the viewer's browser.
function shouldProxyUrl(resourceUrl, documentUrl = "") {
  let resource;
  try {
    resource = new URL(resourceUrl);
  } catch (error) {
    return false;
  }
  if (resource.protocol === "file:") {
    return true;
  }
  if (resource.protocol !== "http:" && resource.protocol !== "https:") {
    return false;
  }
  if (isPrivateHost(resource.hostname)) {
    return true;
  }
  try {
    const document = new URL(documentUrl);
    if ((document.protocol === "http:" || document.protocol === "https:") && document.hostname.toLowerCase() === resource.hostname.toLowerCase()) {
      return true;
    }
  } catch (error) {
    // No document context: only private hosts are proxied.
  }
  return false;
}

function createProxyUrl(resourceUrl, targetId, accessToken = "") {
  if (!accessToken) {
    const params = new URLSearchParams({
      targetId: String(targetId || ""),
      url: String(resourceUrl || "")
    });
    return `${PROXY_PATH}?${params.toString()}`;
  }
  const parsed = new URL(resourceUrl);
  const scheme = parsed.protocol.replace(/:$/, "");
  return `${PROXY_PREFIX}${encodeURIComponent(String(targetId || ""))}/${accessToken}/${scheme}/${parsed.host || "-"}${parsed.pathname}${parsed.search}`;
}

function proxyPrefixFor(targetId, accessToken) {
  return `${PROXY_PREFIX}${encodeURIComponent(String(targetId || ""))}/${accessToken || "-"}`;
}

// Inverse of createProxyUrl for the path form. Returns null for other paths.
function parseProxyPath(pathname, search = "") {
  const match = String(pathname || "").match(/^\/p\/([^/]+)\/([^/]+)\/(https?|file)\/([^/]*)(\/.*)?$/);
  if (!match) {
    return null;
  }
  const host = match[4] === "-" ? "" : match[4];
  return {
    targetId: decodeURIComponent(match[1]),
    accessToken: match[2] === "-" ? "" : match[2],
    url: `${match[3]}://${host}${match[5] || "/"}${search || ""}`
  };
}

function createBrowserBridgeScript(finalUrl, targetId, accessToken = "") {
  return `<script data-krd-browser-bridge>
(function () {
  var finalUrl = ${scriptJson(finalUrl)};
  var targetId = ${scriptJson(targetId)};
  var proxyPrefix = ${scriptJson(proxyPrefixFor(targetId, accessToken))};
  var privateSuffixes = [".local", ".localhost", ".lan", ".internal", ".home.arpa", ".ts.net", ".localdomain"];

  function isPrivateHost(hostname) {
    var host = String(hostname || "").toLowerCase().replace(/^\\[|\\]$/g, "");
    if (!host || host === "localhost" || host === "0.0.0.0" || host === "::1") { return true; }
    for (var i = 0; i < privateSuffixes.length; i += 1) { if (host.slice(-privateSuffixes[i].length) === privateSuffixes[i]) { return true; } }
    if (host.indexOf(".") < 0 && host.indexOf(":") < 0) { return true; }
    var v4 = host.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
    if (v4) {
      var a = Number(v4[1]), b = Number(v4[2]);
      return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    if (host.indexOf(":") >= 0) { return /^(fc|fd|fe[89ab])/i.test(host); }
    return false;
  }

  function shouldProxy(resolved) {
    if (resolved.protocol === "file:") { return true; }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") { return false; }
    if (isPrivateHost(resolved.hostname)) { return true; }
    try {
      var doc = new URL(finalUrl);
      return (doc.protocol === "http:" || doc.protocol === "https:") && doc.hostname.toLowerCase() === resolved.hostname.toLowerCase();
    } catch (error) { return false; }
  }

  function toProxyUrl(resolved) {
    return proxyPrefix + "/" + resolved.protocol.replace(/:$/, "") + "/" + (resolved.host || "-") + resolved.pathname + resolved.search + resolved.hash;
  }

  // Absolute target URLs and root-relative paths need rerouting; plain
  // relative references already resolve under the proxy path.
  function reroute(value) {
    var text = String(value || "");
    if (!text || text.indexOf("/p/") === 0 || text.indexOf("/api/") === 0 || text.charAt(0) === "#") { return ""; }
    var resolved;
    try {
      if (/^(https?|file):/i.test(text)) { resolved = new URL(text); }
      else if (text.charAt(0) === "/" && text.charAt(1) !== "/") { resolved = new URL(text, finalUrl); }
      else if (text.indexOf("//") === 0) { resolved = new URL(text, finalUrl); }
      else { return ""; }
    } catch (error) { return ""; }
    return shouldProxy(resolved) ? toProxyUrl(resolved) : "";
  }

  // The deck's own proxy form, or an absolute target URL, back to the target URL.
  function toTargetUrl(href) {
    if (!href || String(href).trim().charAt(0) === "#") {
      return "";
    }
    try {
      var resolved = new URL(href, window.location.href);
      if (resolved.pathname === "${PROXY_PATH}" && resolved.searchParams.has("url")) {
        return resolved.searchParams.get("url") || "";
      }
      var pathMatch = resolved.pathname.match(/^\\/p\\/[^/]+\\/[^/]+\\/(https?|file)\\/([^/]*)(\\/.*)?$/);
      if (pathMatch) {
        return pathMatch[1] + "://" + (pathMatch[2] === "-" ? "" : pathMatch[2]) + (pathMatch[3] || "/") + resolved.search + resolved.hash;
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

  function post(type, url, extra) {
    if (!url) {
      return;
    }
    var message = { source: "kitty-remote-deck-browser", type: type, targetId: targetId, url: url };
    if (extra) { for (var key in extra) { message[key] = extra[key]; } }
    window.parent.postMessage(message, "*");
  }

  // Runtime requests: fetch(), XMLHttpRequest and EventSource.
  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string" || input instanceof URL) {
          var rerouted = reroute(String(input));
          if (rerouted) { input = rerouted; }
        } else if (input && typeof input.url === "string") {
          var reroutedRequest = reroute(input.url);
          if (reroutedRequest) { input = new Request(reroutedRequest, input); }
        }
      } catch (error) {}
      return nativeFetch.call(this, input, init);
    };
  }
  if (window.XMLHttpRequest) {
    var nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      try { var rerouted = reroute(String(url)); if (rerouted) { args[1] = rerouted; } } catch (error) {}
      return nativeOpen.apply(this, args);
    };
  }
  if (window.EventSource) {
    var NativeEventSource = window.EventSource;
    window.EventSource = function (url, init) {
      var rerouted = "";
      try { rerouted = reroute(String(url)); } catch (error) {}
      return new NativeEventSource(rerouted || url, init);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }

  // Elements created or retargeted at runtime (img.src = "file:///..." or "/abs").
  var watchedAttributes = ["src", "href", "poster", "data", "xlink:href"];
  function fixElement(element) {
    if (!element || element.nodeType !== 1) { return; }
    for (var i = 0; i < watchedAttributes.length; i += 1) {
      var name = watchedAttributes[i];
      if (!element.hasAttribute(name)) { continue; }
      if (name === "href" && element.tagName && element.tagName.toLowerCase() === "a") { continue; }
      var rerouted = reroute(element.getAttribute(name));
      if (rerouted) { element.setAttribute(name, rerouted); }
    }
  }
  if (window.MutationObserver) {
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i += 1) {
        var record = records[i];
        if (record.type === "attributes") { fixElement(record.target); continue; }
        for (var j = 0; j < record.addedNodes.length; j += 1) {
          var node = record.addedNodes[j];
          fixElement(node);
          if (node.querySelectorAll) {
            var nested = node.querySelectorAll("[src],[href],[poster],[data]");
            for (var k = 0; k < nested.length; k += 1) { fixElement(nested[k]); }
          }
        }
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: watchedAttributes });
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

  var lastTitle = null;
  function postTitle(type) {
    var title = String(document.title || "").trim();
    if (type === "browser:title" && title === lastTitle) { return; }
    lastTitle = title;
    post(type, finalUrl, { title: title });
  }
  postTitle("browser:loaded");
  window.addEventListener("load", function () { postTitle("browser:title"); });
  if (window.MutationObserver) {
    new MutationObserver(function () { postTitle("browser:title"); }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }
})();
</script>`;
}

function injectBrowserBridge(html, finalUrl, targetId, accessToken = "") {
  const script = createBrowserBridgeScript(finalUrl, targetId, accessToken);
  const value = String(html);

  // The bridge goes first in <head> so its fetch/XHR patches are in place
  // before the page's own scripts run.
  if (/<head\b[^>]*>/i.test(value)) {
    return value.replace(/<head\b[^>]*>/i, (match) => `${match}${script}`);
  }

  if (/<html\b[^>]*>/i.test(value)) {
    return value.replace(/<html\b[^>]*>/i, (match) => `${match}${script}`);
  }

  return `${script}${value}`;
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

// The value an attribute or url() should carry: the proxy URL when the target
// must fetch it, the absolute URL when the viewer's browser can, or the
// original text when it is not a URL the deck handles.
function rewriteReference(rawValue, baseUrl, targetId, options = {}) {
  const resolved = resolveResourceUrl(baseUrl, rawValue);
  if (!resolved) {
    return rawValue;
  }
  const documentUrl = options.finalUrl || baseUrl;
  return shouldProxyUrl(resolved, documentUrl) ? createProxyUrl(resolved, targetId, options.accessToken) : resolved;
}

function rewriteSrcset(value, baseUrl, targetId, options = {}) {
  return String(value)
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) {
        return trimmed;
      }
      const parts = trimmed.split(/\s+/);
      return [rewriteReference(parts[0], baseUrl, targetId, options), ...parts.slice(1)].join(" ");
    })
    .join(", ");
}

function rewriteCssResources(css, baseUrl, targetId, options = {}) {
  return String(css)
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, rawValue) => {
      const next = rewriteReference(rawValue, baseUrl, targetId, options);
      return next === rawValue ? match : `url("${next}")`;
    })
    // @import "x.css" / @import 'x.css' without url()
    .replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, rawValue) => {
      const next = rewriteReference(rawValue, baseUrl, targetId, options);
      return next === rawValue ? match : `@import "${next}"`;
    });
}

function rewriteStyleAttribute(value, baseUrl, targetId, options = {}) {
  return rewriteCssResources(value, baseUrl, targetId, options);
}

function ensureAnonymousCrossoriginForProxyResources(html) {
  return String(html).replace(
    /<(script|img|video|audio|link)\b([^>]*\b(?:src|href)\s*=\s*(["'])(?:\/api\/url-resource\?|\/p\/)[^>]*?)>/gi,
    (match, tagName, attributes) => {
      if (/\scrossorigin\s*=/i.test(attributes)) {
        return match;
      }

      const slash = /\/\s*$/.test(attributes) ? " /" : "";
      const cleanAttributes = slash ? attributes.replace(/\/\s*$/, "").trimEnd() : attributes;
      return `<${tagName}${cleanAttributes} crossorigin="anonymous"${slash}>`;
    }
  );
}

function rewriteHtmlResources(html, baseUrl, targetId, options = {}) {
  const rewrittenAttrs = String(html).replace(
    /\s([a-zA-Z:-]+)\s*=\s*(["'])(.*?)\2/gs,
    (match, rawName, quote, rawValue) => {
      const name = rawName.toLowerCase();
      let nextValue = rawValue;

      if (REWRITABLE_ATTRS.has(name)) {
        nextValue = rewriteReference(rawValue, baseUrl, targetId, options);
      } else if (name === "srcset") {
        nextValue = rewriteSrcset(rawValue, baseUrl, targetId, options);
      } else if (name === "style") {
        nextValue = rewriteStyleAttribute(rawValue, baseUrl, targetId, options);
      }

      return ` ${rawName}=${quote}${htmlEscapeAttribute(nextValue)}${quote}`;
    }
  );

  const withCorsHints = ensureAnonymousCrossoriginForProxyResources(rewrittenAttrs);
  const withoutRefresh = withCorsHints.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])refresh\1[^>]*>/gi, "");
  if (options.injectBrowserBridge === false) {
    return withoutRefresh;
  }
  return injectBrowserBridge(withoutRefresh, options.finalUrl || baseUrl, targetId, options.accessToken);
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
  PROXY_PREFIX,
  createProxyUrl,
  createBrowserBridgeScript,
  ensureAnonymousCrossoriginForProxyResources,
  isCssContentType,
  isHtmlContentType,
  isPrivateHost,
  isTextLikeContentType,
  parseProxyPath,
  resolveResourceUrl,
  rewriteCssResources,
  rewriteHtmlResources,
  shouldProxyUrl
};
