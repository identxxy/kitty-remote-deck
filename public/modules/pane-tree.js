// Device-local view splits, after deepseek-harness ui-layout/panes.ts: a binary
// tree of leaves (one terminal view each) and splits (direction + ratio). The
// tree lives in browser storage; tmux and kitty never see it.
(function attachPaneTree(global) {
  const MAX_DEPTH = 8;
  const MAX_NODES = 31;
  const MIN_RATIO = 0.2;
  const MAX_RATIO = 0.8;

  let idCounter = 0;

  function nextId(prefix) {
    idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
  }

  function leaf(actor, id = nextId("view")) {
    return { kind: "leaf", id, actor: normalizeActor(actor) };
  }

  function normalizeActor(actor) {
    const windowId = Number(actor?.windowId);
    return {
      targetId: typeof actor?.targetId === "string" && actor.targetId ? actor.targetId : null,
      socket: typeof actor?.socket === "string" ? actor.socket : "",
      windowId: Number.isInteger(windowId) && windowId >= 0 ? windowId : null
    };
  }

  function nodeCount(node) {
    return node.kind === "leaf" ? 1 : 1 + nodeCount(node.first) + nodeCount(node.second);
  }

  function leafDepth(node, paneId, depth = 0) {
    if (node.kind === "leaf") {
      return node.id === paneId ? depth : undefined;
    }
    return leafDepth(node.first, paneId, depth + 1) ?? leafDepth(node.second, paneId, depth + 1);
  }

  function leaves(node, out = []) {
    if (!node) {
      return out;
    }
    if (node.kind === "leaf") {
      out.push(node);
    } else {
      leaves(node.first, out);
      leaves(node.second, out);
    }
    return out;
  }

  function firstPaneId(node) {
    const all = leaves(node);
    return all.length ? all[0].id : null;
  }

  function hasPaneId(node, paneId) {
    return leaves(node).some((item) => item.id === paneId);
  }

  function findPane(node, paneId) {
    return leaves(node).find((item) => item.id === paneId) || null;
  }

  function replacePaneActor(node, paneId, actor) {
    if (node.kind === "leaf") {
      return node.id === paneId ? { ...node, actor: normalizeActor(actor) } : node;
    }
    return { ...node, first: replacePaneActor(node.first, paneId, actor), second: replacePaneActor(node.second, paneId, actor) };
  }

  // Split one leaf: it stays first, the new leaf goes second. Over-deep or
  // over-full trees are returned unchanged.
  function splitPane(node, paneId, direction, actor, ids = {}) {
    const depth = leafDepth(node, paneId);
    if (depth === undefined || depth + 1 > MAX_DEPTH || nodeCount(node) + 2 > MAX_NODES) {
      return { tree: node, newPaneId: null };
    }
    const newPaneId = ids.paneId || nextId("view");
    const splitId = ids.splitId || nextId("split");
    const apply = (current) => {
      if (current.kind === "leaf") {
        return current.id === paneId
          ? { kind: "split", id: splitId, direction, ratio: 0.5, first: current, second: leaf(actor, newPaneId) }
          : current;
      }
      return { ...current, first: apply(current.first), second: apply(current.second) };
    };
    return { tree: apply(node), newPaneId };
  }

  // Close one leaf; its parent split collapses onto the sibling. Null when the
  // last leaf closes.
  function closePane(node, paneId) {
    if (node.kind === "leaf") {
      return node.id === paneId ? null : node;
    }
    const first = closePane(node.first, paneId);
    const second = closePane(node.second, paneId);
    if (first === null) {
      return second;
    }
    if (second === null) {
      return first;
    }
    return first === node.first && second === node.second ? node : { ...node, first, second };
  }

  function clampRatio(ratio) {
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, Number(ratio) || 0.5));
  }

  function resizePaneSplit(node, splitId, ratio) {
    if (node.kind === "leaf") {
      return node;
    }
    if (node.id === splitId) {
      return { ...node, ratio: clampRatio(ratio) };
    }
    return { ...node, first: resizePaneSplit(node.first, splitId, ratio), second: resizePaneSplit(node.second, splitId, ratio) };
  }

  function decodeNode(value, depth, ids, count) {
    if (depth > MAX_DEPTH) {
      throw new Error(`pane tree exceeds depth ${MAX_DEPTH}`);
    }
    count.value += 1;
    if (count.value > MAX_NODES) {
      throw new Error(`pane tree exceeds ${MAX_NODES} nodes`);
    }
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) {
      throw new Error("pane node must have a string id");
    }
    if (ids.has(value.id)) {
      throw new Error(`duplicate pane node id ${value.id}`);
    }
    ids.add(value.id);
    if (value.kind === "leaf") {
      return leaf(value.actor, value.id);
    }
    if (value.kind === "split") {
      if (value.direction !== "horizontal" && value.direction !== "vertical") {
        throw new Error("pane split direction must be horizontal or vertical");
      }
      return {
        kind: "split",
        id: value.id,
        direction: value.direction,
        ratio: clampRatio(value.ratio),
        first: decodeNode(value.first, depth + 1, ids, count),
        second: decodeNode(value.second, depth + 1, ids, count)
      };
    }
    throw new Error("pane node kind must be leaf or split");
  }

  // Validate a layout restored from storage; throws on anything malformed.
  function decodePersistedPaneLayout(value) {
    if (!value || typeof value !== "object" || value.paneVersion !== 1) {
      throw new Error("unsupported pane layout");
    }
    const paneRoot = value.paneRoot === null ? null : decodeNode(value.paneRoot, 0, new Set(), { value: 0 });
    let activePaneId = typeof value.activePaneId === "string" ? value.activePaneId : null;
    if (paneRoot && !hasPaneId(paneRoot, activePaneId)) {
      activePaneId = firstPaneId(paneRoot);
    }
    return { paneVersion: 1, paneRoot, activePaneId: paneRoot ? activePaneId : null };
  }

  const api = {
    MAX_DEPTH,
    MAX_NODES,
    leaf,
    normalizeActor,
    leaves,
    firstPaneId,
    hasPaneId,
    findPane,
    replacePaneActor,
    splitPane,
    closePane,
    resizePaneSplit,
    decodePersistedPaneLayout
  };

  global.KRDPaneTree = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
