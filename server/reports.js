// Reports: pages opened in the embedded Browser, kept server-side so the list
// is the same on every device. One entry per (target, url); opening again
// refreshes the title and time, pinning keeps an entry at the top.
const fs = require("fs");
const fsp = require("fs/promises");

const MAX_REPORTS = 200;
const MAX_TITLE_LENGTH = 160;

function createReportId() {
  return `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUrl(value) {
  const parsed = new URL(String(value || "").trim());
  if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
    throw new Error("Only http://, https://, and file:// URLs can be listed.");
  }
  parsed.hash = "";
  return parsed.href;
}

function normalizeTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_LENGTH);
}

function sortReports(reports) {
  return reports.slice().sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return String(b.openedAt).localeCompare(String(a.openedAt));
  });
}

function createReportStore(filePath) {
  async function read() {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
    } catch (error) {
      return [];
    }
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    const reports = Array.isArray(parsed?.reports) ? parsed.reports : [];
    return reports.flatMap((item) => {
      try {
        return [{
          id: String(item.id || createReportId()),
          targetId: String(item.targetId || ""),
          url: normalizeUrl(item.url),
          title: normalizeTitle(item.title),
          pinned: Boolean(item.pinned),
          createdAt: String(item.createdAt || item.openedAt || new Date().toISOString()),
          openedAt: String(item.openedAt || item.createdAt || new Date().toISOString())
        }];
      } catch (error) {
        return [];
      }
    });
  }

  async function write(reports) {
    // Temp file + rename: a reader never sees a half-written list.
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tempPath, JSON.stringify({ reports: sortReports(reports) }, null, 2));
    await fsp.rename(tempPath, filePath);
  }

  // Page loads and title updates arrive together; operations run one at a
  // time so a read-modify-write never interleaves with another.
  let queue = Promise.resolve();
  function serialized(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  // Records a visit: creates the entry or refreshes its title and time.
  async function recordNow(input) {
    const targetId = String(input?.targetId || "").trim();
    if (!targetId) {
      throw new Error("targetId is required.");
    }
    const url = normalizeUrl(input?.url);
    const title = normalizeTitle(input?.title);
    const now = new Date().toISOString();
    const reports = await read();
    let report = reports.find((item) => item.targetId === targetId && item.url === url);
    if (report) {
      report.openedAt = now;
      if (title) {
        report.title = title;
      }
    } else {
      report = { id: createReportId(), targetId, url, title, pinned: false, createdAt: now, openedAt: now };
      reports.push(report);
    }
    // Oldest unpinned entries make room.
    const sorted = sortReports(reports);
    while (sorted.length > MAX_REPORTS) {
      const index = sorted.map((item) => item.pinned).lastIndexOf(false);
      if (index < 0) {
        break;
      }
      sorted.splice(index, 1);
    }
    await write(sorted);
    return report;
  }

  async function updateNow(id, changes) {
    const reports = await read();
    const report = reports.find((item) => item.id === id);
    if (!report) {
      throw new Error("Report not found.");
    }
    if (typeof changes?.pinned === "boolean") {
      report.pinned = changes.pinned;
    }
    if (typeof changes?.title === "string") {
      report.title = normalizeTitle(changes.title);
    }
    await write(reports);
    return report;
  }

  async function removeNow(id) {
    const reports = await read();
    const next = reports.filter((item) => item.id !== id);
    if (next.length === reports.length) {
      throw new Error("Report not found.");
    }
    await write(next);
  }

  return {
    async list() {
      return sortReports(await read());
    },
    record(input) {
      return serialized(() => recordNow(input));
    },
    update(id, changes) {
      return serialized(() => updateNow(id, changes));
    },
    remove(id) {
      return serialized(() => removeNow(id));
    }
  };
}

module.exports = { MAX_REPORTS, createReportStore, normalizeUrl };
