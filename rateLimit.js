import fs from "fs";
import path from "path";

// Resolve data directory the same way as index.js and premium.js
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const FREE_LIMITS = {
  play: 2,
  download: 2,
  song_cmd: 2,
  chatgpt: 4,
  lyrics: 4,
  short: 2,
  instagram: 2,
  video: 2,
  // Legacy/shared buckets for commands not yet migrated.
  song: 2,
  song_legacy: 2,
  video_legacy: 2
};

let dbInitAttempted = false;
let dbPool = null;

function toUserId(jid) {
  if (!jid) return "";
  return String(jid).trim().split("@")[0].split(":")[0];
}

async function getDbPool() {
  if (dbInitAttempted) return dbPool;
  dbInitAttempted = true;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("DATABASE_URL not set. Using JSON usage store.");
    return null;
  }

  try {
    const { Pool } = await import("pg");
    dbPool = new Pool({
      connectionString,
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
    });

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS usage_limits (
        jid TEXT NOT NULL,
        command_type TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (jid, command_type)
      );
    `);

    console.log("Postgres usage store ready.");
    return dbPool;
  } catch (err) {
    console.error("Failed to initialize Postgres usage store, falling back to JSON:", err?.message || err);
    dbPool = null;
    return null;
  }
}

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

function checkAndIncrementJsonLimit(senderJid, type) {
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

export async function checkAndIncrementLimit(senderJid, type) {
  const limit = FREE_LIMITS[type] ?? 1;
  const senderId = toUserId(senderJid);
  if (!senderId) return false;

  const pool = await getDbPool();
  if (pool) {
    try {
      const result = await pool.query(
        `
        INSERT INTO usage_limits (jid, command_type, count)
        VALUES ($1, $2, 1)
        ON CONFLICT (jid, command_type)
        DO UPDATE SET
          count = usage_limits.count + 1,
          updated_at = NOW()
        WHERE usage_limits.count < $3
        RETURNING count
        `,
        [senderId, type, limit]
      );

      return result.rowCount > 0;
    } catch (err) {
      console.error("Postgres usage check failed, using JSON fallback:", err?.message || err);
    }
  }

  return checkAndIncrementJsonLimit(senderJid, type);
}
