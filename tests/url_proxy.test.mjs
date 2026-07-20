import assert from "node:assert/strict";
import test from "node:test";

import proxy from "../server/url_proxy.js";

const {
  createProxyUrl,
  ensureAnonymousCrossoriginForProxyResources,
  rewriteCssResources,
  rewriteHtmlResources
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

test("proxy URLs can carry scoped preview access tokens", () => {
  assert.equal(
    createProxyUrl("file:///tmp/report/movie.mp4", "local", "token.abc"),
    "/api/url-resource?targetId=local&url=file%3A%2F%2F%2Ftmp%2Freport%2Fmovie.mp4&access=token.abc"
  );

  const rewritten = rewriteHtmlResources(
    '<video src="movie.mp4"></video>',
    "file:///tmp/report/index.html",
    "local",
    { accessToken: "token.abc" }
  );

  assert.match(rewritten, /access=token\.abc/);
});

test("HTML bridge script reports browser loads and intercepts in-frame navigation", () => {
  const html = "<!doctype html><body><a href=\"next.html\">next</a></body>";
  const rewritten = rewriteHtmlResources(html, "https://example.com/report/index.html", "target-a");

  assert.match(rewritten, /data-krd-browser-bridge/);
  assert.match(rewritten, /source: "kitty-remote-deck-browser"/);
  assert.match(rewritten, /type: type/);
  assert.match(rewritten, /post\("browser:loaded", finalUrl\)/);
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
