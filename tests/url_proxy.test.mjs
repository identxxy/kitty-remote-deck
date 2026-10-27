import assert from "node:assert/strict";
import test from "node:test";

import proxy from "../server/url_proxy.js";

const {
  createProxyUrl,
  ensureAnonymousCrossoriginForProxyResources,
  parseProxyPath,
  rewriteCssResources,
  rewriteHtmlResources,
  shouldProxyUrl
} = proxy;

test("HTML resources are rewritten to same-origin proxy URLs", () => {
  const html = `
    <link rel="stylesheet" href="style.css">
    <script src="./app.js"></script>
    <img src="images/plot.png">
    <a href="../next.html">next</a>
    <a href="#section">section</a>
  `;

  const rewritten = rewriteHtmlResources(html, "file:///tmp/report/index.html", "local");

  assert.match(rewritten, /href="\/api\/url-resource\?targetId=local&amp;url=file%3A%2F%2F%2Ftmp%2Freport%2Fstyle.css"/);
  assert.match(rewritten, /src="\/api\/url-resource\?targetId=local&amp;url=file%3A%2F%2F%2Ftmp%2Freport%2Fapp.js"/);
  assert.match(rewritten, /src="\/api\/url-resource\?targetId=local&amp;url=file%3A%2F%2F%2Ftmp%2Freport%2Fimages%2Fplot.png"/);
  assert.match(rewritten, /href="\/api\/url-resource\?targetId=local&amp;url=file%3A%2F%2F%2Ftmp%2Fnext.html"/);
  assert.match(rewritten, /href="#section"/);
});

test("CSS url() references are rewritten relative to the stylesheet", () => {
  const css = `
    @font-face { src: url("./fonts/ui.woff2") format("woff2"); }
    main { background: url(images/bg.png); }
  `;

  const rewritten = rewriteCssResources(css, "https://example.com/assets/main.css", "target-a");

  assert.match(rewritten, /url\("\/api\/url-resource\?targetId=target-a&url=https%3A%2F%2Fexample.com%2Fassets%2Ffonts%2Fui.woff2"\)/);
  assert.match(rewritten, /url\("\/api\/url-resource\?targetId=target-a&url=https%3A%2F%2Fexample.com%2Fassets%2Fimages%2Fbg.png"\)/);
});

test("proxy URLs preserve target and absolute resource URL", () => {
  assert.equal(
    createProxyUrl("https://example.com/report/index.html?x=1", "target-a"),
    "/api/url-resource?targetId=target-a&url=https%3A%2F%2Fexample.com%2Freport%2Findex.html%3Fx%3D1"
  );
});

test("proxy URLs with an access token take the path form, so relative references resolve in the browser", () => {
  assert.equal(
    createProxyUrl("file:///tmp/report/movie.mp4", "local", "token.abc"),
    "/p/local/token.abc/file/-/tmp/report/movie.mp4"
  );
  assert.equal(
    createProxyUrl("https://host.lan:8443/a/b?x=1", "t", "tok"),
    "/p/t/tok/https/host.lan:8443/a/b?x=1"
  );
  assert.deepEqual(parseProxyPath("/p/local/token.abc/file/-/tmp/my%20report/index.html", ""), {
    targetId: "local",
    accessToken: "token.abc",
    url: "file:///tmp/my%20report/index.html"
  });
  assert.deepEqual(parseProxyPath("/p/t/tok/https/host.lan:8443/a/b", "?x=1"), {
    targetId: "t",
    accessToken: "tok",
    url: "https://host.lan:8443/a/b?x=1"
  });
  assert.equal(parseProxyPath("/api/health", ""), null);
  assert.equal(parseProxyPath("/p/t/tok/ftp/host/x", ""), null);

  const rewritten = rewriteHtmlResources(
    '<video src="movie.mp4"></video><object data="d.svg"></object>',
    "file:///tmp/report/index.html",
    "local",
    { accessToken: "token.abc" }
  );

  assert.match(rewritten, /src="\/p\/local\/token\.abc\/file\/-\/tmp\/report\/movie\.mp4"/);
  assert.match(rewritten, /data="\/p\/local\/token\.abc\/file\/-\/tmp\/report\/d\.svg"/);
});

test("public http(s) hosts load directly, private hosts and the document's own host go through the target", () => {
  assert.equal(shouldProxyUrl("https://cdn.jsdelivr.net/npm/x.js", "file:///tmp/r/index.html"), false);
  assert.equal(shouldProxyUrl("http://localhost:8080/data.json", "file:///tmp/r/index.html"), true);
  assert.equal(shouldProxyUrl("http://gpu-node/x", "file:///tmp/r/index.html"), true);
  assert.equal(shouldProxyUrl("http://100.88.88.1:3040/y", "file:///tmp/r/index.html"), true);
  assert.equal(shouldProxyUrl("http://192.168.1.4/y", ""), true);
  assert.equal(shouldProxyUrl("https://example.com/img.png", "https://example.com/page.html"), true);
  assert.equal(shouldProxyUrl("https://example.com/img.png", "https://other.org/page.html"), false);
  assert.equal(shouldProxyUrl("file:///tmp/x", ""), true);

  const rewritten = rewriteHtmlResources(
    '<script src="https://cdn.plot.ly/plotly.js"></script><img src="http://localhost:8080/plot.png">',
    "file:///tmp/report/index.html",
    "local",
    { accessToken: "tok" }
  );
  assert.match(rewritten, /src="https:\/\/cdn\.plot\.ly\/plotly\.js"/);
  assert.match(rewritten, /src="\/p\/local\/tok\/http\/localhost:8080\/plot\.png"/);
});

test("CSS @import strings are rewritten like url() references", () => {
  const css = `@import "theme.css"; @import url(x.css); @import 'https://fonts.googleapis.com/css';`;
  const rewritten = rewriteCssResources(css, "file:///tmp/r/s.css", "t", { accessToken: "tok" });
  assert.match(rewritten, /@import "\/p\/t\/tok\/file\/-\/tmp\/r\/theme\.css"/);
  assert.match(rewritten, /@import url\("\/p\/t\/tok\/file\/-\/tmp\/r\/x\.css"\)/);
  assert.match(rewritten, /@import 'https:\/\/fonts\.googleapis\.com\/css'/);
});

test("HTML bridge script reports browser loads and intercepts in-frame navigation", () => {
  const html = "<!doctype html><body><a href=\"next.html\">next</a></body>";
  const rewritten = rewriteHtmlResources(html, "https://example.com/report/index.html", "target-a");

  assert.match(rewritten, /data-krd-browser-bridge/);
  assert.match(rewritten, /source: "kitty-remote-deck-browser"/);
  assert.match(rewritten, /type: type/);
  assert.match(rewritten, /postTitle\("browser:loaded"\)/);
  // The bridge is injected at the top of <head> so fetch/XHR patches precede page scripts.
  assert.match(rewritten, /window\.fetch = function/);
  assert.match(rewritten, /XMLHttpRequest\.prototype\.open = function/);
  assert.ok(rewritten.indexOf("data-krd-browser-bridge") < rewritten.indexOf("<a href"));
  assert.match(rewritten, /event\.preventDefault\(\)/);
  assert.match(rewritten, /https:\/\/example\.com\/report\/index\.html/);
});

test("proxied browser render resources opt into anonymous CORS", () => {
  const html = `
    <script type="module" src="./app.js"></script>
    <img src="textures/diffuse.png">
    <video src="movies/demo.mp4"></video>
    <video controls><source src="movies/clip.mp4" type="video/mp4"></video>
    <link rel="stylesheet" href="style.css">
    <a href="next.html">next</a>
  `;

  const rewritten = rewriteHtmlResources(html, "https://example.com/scene/index.html", "target-a");

  assert.match(rewritten, /<script[^>]+crossorigin="anonymous"[^>]*>/);
  assert.match(rewritten, /<img[^>]+crossorigin="anonymous"[^>]*>/);
  assert.match(rewritten, /<video[^>]+crossorigin="anonymous"[^>]*>/);
  assert.match(rewritten, /<source[^>]+src="\/api\/url-resource\?targetId=target-a&amp;url=https%3A%2F%2Fexample.com%2Fscene%2Fmovies%2Fclip.mp4"/);
  assert.match(rewritten, /<link[^>]+crossorigin="anonymous"[^>]*>/);
  assert.doesNotMatch(rewritten, /<a[^>]+crossorigin=/);
});

test("existing crossorigin attributes are preserved", () => {
  const html = '<script src="/api/url-resource?targetId=a&url=https%3A%2F%2Fexample.com%2Fa.js" crossorigin="use-credentials"></script>';
  const rewritten = ensureAnonymousCrossoriginForProxyResources(html);

  assert.equal((rewritten.match(/crossorigin=/g) || []).length, 1);
  assert.match(rewritten, /crossorigin="use-credentials"/);
});
