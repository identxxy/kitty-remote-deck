// Line-level helpers shared by the server (delta transport) and the page
// (incremental DOM updates). A screen or scrollback capture is treated as an
// array of lines; between two captures most lines are unchanged, new lines are
// appended at the end, and once the history limit is reached old lines drop off
// the top.
(function attachTerminalLines(global) {
  const MAX_DROP = 512;
  const MIN_MATCH = 8;

  function splitLines(text) {
    return String(text || "").split("\n");
  }

  function prefixLength(oldLines, offset, newLines) {
    const limit = Math.min(oldLines.length - offset, newLines.length);
    let count = 0;
    while (count < limit && oldLines[offset + count] === newLines[count]) {
      count += 1;
    }
    return count;
  }

  // Describe newLines as oldLines.slice(drop, drop + keep) followed by tail.
  // `drop` is how many lines scrolled off the top; when nothing lines up the
  // result keeps nothing and tail is the whole capture.
  function computeLineDelta(oldLines, newLines) {
    let drop = 0;
    let keep = prefixLength(oldLines, 0, newLines);
    if (keep < MIN_MATCH && newLines.length >= MIN_MATCH) {
      const maxDrop = Math.min(MAX_DROP, oldLines.length - 1);
      for (let offset = 1; offset <= maxDrop; offset += 1) {
        const count = prefixLength(oldLines, offset, newLines);
        if (count > keep) {
          drop = offset;
          keep = count;
          if (count === newLines.length) {
            break;
          }
        }
      }
      if (keep < MIN_MATCH) {
        drop = oldLines.length;
        keep = 0;
      }
    }
    return { drop, keep, tail: newLines.slice(keep) };
  }

  function applyLineDelta(oldLines, delta) {
    const drop = Math.max(0, Number(delta.drop) || 0);
    const keep = Math.max(0, Number(delta.keep) || 0);
    const tail = Array.isArray(delta.tail) ? delta.tail : [];
    return oldLines.slice(drop, drop + keep).concat(tail);
  }

  // Replace only the lines that changed. Each line is one block element so the
  // browser lays out and repaints the changed rows, not the whole scrollback.
  function renderLines(output, lines, renderLineHtml) {
    const visible = lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
    const previous = output.__renderedLines;
    const lineHtml = (line) => `<div class="terminal-line">${renderLineHtml(line) || "<br>"}</div>`;
    const reusable =
      Array.isArray(previous) &&
      output.childElementCount === previous.length &&
      (previous.length === 0 || output.firstElementChild.classList.contains("terminal-line"));

    if (!reusable) {
      output.innerHTML = visible.map(lineHtml).join("");
      output.__renderedLines = visible.slice();
      return { replaced: visible.length };
    }

    // Align on scrolled-off lines first (history-limit case), then reuse the
    // common prefix and suffix, replacing only the rows between.
    const delta = computeLineDelta(previous, visible);
    for (let index = 0; index < delta.drop; index += 1) {
      output.firstElementChild.remove();
    }
    const previousTail = previous.slice(delta.drop + delta.keep);
    const max = Math.min(previousTail.length, delta.tail.length);
    let suffix = 0;
    while (suffix < max && previousTail[previousTail.length - 1 - suffix] === delta.tail[delta.tail.length - 1 - suffix]) {
      suffix += 1;
    }
    const removeCount = previousTail.length - suffix;
    const inserted = delta.tail.slice(0, delta.tail.length - suffix);
    for (let index = 0; index < removeCount; index += 1) {
      output.children[delta.keep].remove();
    }
    if (inserted.length) {
      const template = output.ownerDocument.createElement("template");
      template.innerHTML = inserted.map(lineHtml).join("");
      output.insertBefore(template.content, output.children[delta.keep] || null);
    }
    output.__renderedLines = visible.slice();
    return { replaced: inserted.length, removed: removeCount };
  }

  const api = { splitLines, computeLineDelta, applyLineDelta, renderLines, MIN_MATCH };

  global.KRDTerminalLines = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
