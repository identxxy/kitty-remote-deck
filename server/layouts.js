// Named view layouts: a pane tree whose leaves name a target, socket and
// pane, plus the pinned Browser, stored server-side so every device sees the
// same list.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const PANE_TREE = require("../public/modules/pane-tree");

const MAX_LAYOUTS = 50;
const MAX_NAME_LENGTH = 60;
const MAX_BROWSER_URL_LENGTH = 2048;

// The Browser part of a layout: a URL and the target it is fetched through.
function normalizeBrowser(input) {
  if (!input || typeof input !== "object" || typeof input.url !== "string" || !input.url.trim()) {
    return null;
  }
  const url = input.url.trim();
  if (url.length > MAX_BROWSER_URL_LENGTH) {
    throw new Error(`Browser URL must be at most ${MAX_BROWSER_URL_LENGTH} characters.`);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error("Browser URL is not a valid URL.");
  }
  if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
    throw new Error("Browser URL must use http, https or file.");
  }
  return { url, targetId: typeof input.targetId === "string" ? input.targetId.trim() : "" };
}

function createLayoutId() {
  return `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLayout(input, existing = null) {
  const name = String(input?.name ?? existing?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) {
    throw new Error("Layout name is required.");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Layout name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  const layout = PANE_TREE.decodePersistedPaneLayout({
    paneVersion: 1,
    paneRoot: input?.paneRoot,
    activePaneId: input?.activePaneId
  });
  if (!layout.paneRoot) {
    throw new Error("Layout needs at least one view.");
  }
  const now = new Date().toISOString();
  return {
    id: String(existing?.id || input?.id || createLayoutId()).trim(),
    name,
    paneRoot: layout.paneRoot,
    activePaneId: layout.activePaneId,
    browser: normalizeBrowser(input?.browser),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function createLayoutStore(filePath) {
  // Lists saved before the rename live in profiles.json next to layouts.json.
  const legacyPath = path.join(path.dirname(filePath), "profiles.json");

  async function exists(candidate) {
    try {
      await fsp.access(candidate, fs.constants.F_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function read() {
    const sourcePath = (await exists(filePath)) ? filePath : (await exists(legacyPath)) ? legacyPath : null;
    if (!sourcePath) {
      return { layouts: [] };
    }
    const parsed = JSON.parse(await fsp.readFile(sourcePath, "utf8"));
    const stored = parsed?.layouts ?? parsed?.profiles;
    const layouts = Array.isArray(stored) ? stored : [];
    return {
      layouts: layouts.flatMap((item) => {
        try {
          return [{ ...normalizeLayout(item, item), updatedAt: item.updatedAt || item.createdAt }];
        } catch (error) {
          return [];
        }
      })
    };
  }

  async function write(store) {
    // Temp file + rename: a reader never sees a half-written list.
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tempPath, JSON.stringify(store, null, 2));
    await fsp.rename(tempPath, filePath);
  }

  // Operations run one at a time so read-modify-write cycles never interleave.
  let queue = Promise.resolve();
  function serialized(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  // Creates a layout, or replaces the one whose id is given.
  async function upsertNow(input) {
    const store = await read();
    const index = store.layouts.findIndex((item) => item.id === input?.id);
    const layout = normalizeLayout(input, index >= 0 ? store.layouts[index] : null);
    if (index >= 0) {
      store.layouts[index] = layout;
    } else {
      if (store.layouts.length >= MAX_LAYOUTS) {
        throw new Error(`At most ${MAX_LAYOUTS} layouts can be saved.`);
      }
      store.layouts.push(layout);
    }
    await write(store);
    return layout;
  }

  async function removeNow(id) {
    const store = await read();
    const next = store.layouts.filter((item) => item.id !== id);
    if (next.length === store.layouts.length) {
      throw new Error("Layout not found.");
    }
    await write({ layouts: next });
  }

  return {
    async list() {
      return (await read()).layouts;
    },
    upsert(input) {
      return serialized(() => upsertNow(input));
    },
    remove(id) {
      return serialized(() => removeNow(id));
    }
  };
}

module.exports = { MAX_NAME_LENGTH, MAX_LAYOUTS, createLayoutStore, normalizeLayout };
