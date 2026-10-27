import assert from "node:assert/strict";
import test from "node:test";

import ansiUtils from "../public/modules/ansi-utils.js";

const { renderAnsiTerminalText } = ansiUtils;

test("ANSI renderer preserves basic foreground colors", () => {
  const html = renderAnsiTerminalText("plain \x1b[31mred\x1b[0m done");

  assert.match(html, /plain /);
  assert.match(html, /<span style="color: #cd3131">red<\/span>/);
  assert.match(html, / done/);
});

test("ANSI renderer preserves 256-color and truecolor styles", () => {
  const html = renderAnsiTerminalText("\x1b[38;5;196mhot\x1b[0m \x1b[38;2;1;2;3;48;2;4;5;6mtrue\x1b[0m");

  assert.match(html, /<span style="color: #ff0000">hot<\/span>/);
  assert.match(html, /<span style="color: #010203; background-color: #040506">true<\/span>/);
});

test("ANSI renderer keeps terminal URLs clickable inside colored runs", () => {
  const html = renderAnsiTerminalText("\x1b[32mhttps://example.com/report.html\x1b[0m");

  assert.match(html, /class="terminal-link"/);
  assert.match(html, /data-preview-url="https:\/\/example\.com\/report\.html"/);
  assert.match(html, /style="color: #00bc00"/);
});

test("ANSI renderer converts OSC 8 terminal hyperlinks to hidden-link anchors", () => {
  const html = renderAnsiTerminalText("\x1b]8;;file:///home/user/AGENTS.md\x1b\\AGENTS.md\x1b]8;;\x1b\\");

  assert.doesNotMatch(html, /\]8;;/);
  assert.match(html, /class="terminal-link"/);
  assert.match(html, /data-preview-url="file:\/\/\/home\/user\/AGENTS\.md"/);
  assert.match(html, />AGENTS\.md<\/a>/);
});

test("ANSI renderer strips unsupported OSC control sequences", () => {
  const html = renderAnsiTerminalText("before \x1b]0;window title\x07after");

  assert.equal(html, "before after");
});

test("ANSI renderer only links previewable OSC 8 schemes", () => {
  const unsafe = renderAnsiTerminalText("\x1b]8;;javascript:alert(1)\x07click\x1b]8;;\x07");
  const safe = renderAnsiTerminalText("\x1b]8;;https://example.com\x07docs\x1b]8;;\x07");

  assert.equal(unsafe, "click");
  assert.match(safe, /<a class="terminal-link"[^>]* href="https:\/\/example.com"[^>]*>docs<\/a>/);
  assert.match(safe, /rel="noopener noreferrer"/);
});

test("ANSI renderer marks rule and spinner rows as decoration", () => {
  const html = renderAnsiTerminalText("text\n  ──────\n⠋⠙ \nmixed ── text");

  assert.equal(
    html,
    'text\n<span class="terminal-decoration">  ──────</span>\n<span class="terminal-decoration">⠋⠙ </span>\nmixed ── text'
  );
});

test("ANSI renderer keeps styles across marked line boundaries", () => {
  const html = renderAnsiTerminalText("\x1b[31mred\n───\x1b[0m");

  assert.equal(
    html,
    '<span style="color: #cd3131">red</span>\n<span class="terminal-decoration"><span style="color: #cd3131">───</span></span>'
  );
});
