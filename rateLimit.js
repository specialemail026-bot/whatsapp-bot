import fs from "fs";
import path from "path";

// Resolve data directory the same way as index.js and premium.js
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const FREE_LIMITS = {
  play: 3,
  download: 3,
  song_cmd: 3,
  lyrics: 1,
  short: 2,
  instagram: 1,
  video: 2,
  // Legacy/shared buckets for commands not yet migrated.
  song: 3,
  song_legacy: 3,
  video_legacy: 2
};

function loadUsage() {
  try {
    if (!fs.existsSync(USAGE_FILE)) {
      return {};
    }
    const data = fs.readFileSync(USAGE_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading usage:", err);
    return {};
  }
}

function saveUsage(usage) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch (err) {
    console.error("Error saving usage:", err);
  }
}

export function checkAndIncrementLimit(senderJid, type) {
  // Track usage per-sender (user JID), lifetime by command key.
  const usage = loadUsage();

  if (!usage[senderJid]) {
    usage[senderJid] = { counts: {} };
  }

  const userUsage = usage[senderJid];
  if (!userUsage.counts || typeof userUsage.counts !== "object") {
    userUsage.counts = {};
  }

  // Backward-compatible migration for previous schema.
  if (typeof userUsage.songs === "number" && userUsage.counts.song_legacy === undefined) {
    userUsage.counts.song_legacy = userUsage.songs;
  }
  if (typeof userUsage.videos === "number" && userUsage.counts.video_legacy === undefined) {
    userUsage.counts.video_legacy = userUsage.videos;
  }
  delete userUsage.songs;
  delete userUsage.videos;
  delete userUsage.date;

  const limit = FREE_LIMITS[type] ?? 1;
  const current = userUsage.counts[type] ?? 0;

  if (current >= limit) {
    return false; // Limit reached for this sender
  }

  userUsage.counts[type] = current + 1;
  saveUsage(usage);
  return true;
}
