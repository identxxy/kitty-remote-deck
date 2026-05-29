import assert from "node:assert/strict";
import test from "node:test";

import proxy from "../server/url_proxy.js";

const {
  createProxyUrl,
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
