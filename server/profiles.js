// Named view layouts ("profiles"): a pane tree whose leaves name a target,
// socket and pane, stored server-side so every device sees the same list.
const fs = require("fs");
const fsp = require("fs/promises");

const PANE_TREE = require("../public/modules/pane-tree");

const MAX_PROFILES = 50;
const MAX_NAME_LENGTH = 60;

function createProfileId() {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProfile(input, existing = null) {
  const name = String(input?.name ?? existing?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) {
    throw new Error("Profile name is required.");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Profile name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  const layout = PANE_TREE.decodePersistedPaneLayout({
    paneVersion: 1,
    paneRoot: input?.paneRoot,
    activePaneId: input?.activePaneId
  });
  if (!layout.paneRoot) {
    throw new Error("Profile needs at least one view.");
  }
  const now = new Date().toISOString();
  return {
    id: String(existing?.id || input?.id || createProfileId()).trim(),
    name,
    paneRoot: layout.paneRoot,
    activePaneId: layout.activePaneId,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function createProfileStore(filePath) {
  async function read() {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
    } catch (error) {
      return { profiles: [] };
    }
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    const profiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    return {
      profiles: profiles.flatMap((item) => {
        try {
          return [{ ...normalizeProfile(item, item), updatedAt: item.updatedAt || item.createdAt }];
        } catch (error) {
          return [];
        }
      })
    };
  }

  async function write(store) {
    await fsp.writeFile(filePath, JSON.stringify(store, null, 2));
  }

  return {
    async list() {
      return (await read()).profiles;
    },
    // Creates a profile, or replaces the one whose id is given.
    async upsert(input) {
      const store = await read();
      const index = store.profiles.findIndex((item) => item.id === input?.id);
      const profile = normalizeProfile(input, index >= 0 ? store.profiles[index] : null);
      if (index >= 0) {
        store.profiles[index] = profile;
      } else {
        if (store.profiles.length >= MAX_PROFILES) {
          throw new Error(`At most ${MAX_PROFILES} profiles can be saved.`);
        }
        store.profiles.push(profile);
      }
      await write(store);
      return profile;
    },
    async remove(id) {
      const store = await read();
      const next = store.profiles.filter((item) => item.id !== id);
      if (next.length === store.profiles.length) {
        throw new Error("Profile not found.");
      }
      await write({ profiles: next });
    }
  };
}

module.exports = { MAX_NAME_LENGTH, MAX_PROFILES, createProfileStore, normalizeProfile };
