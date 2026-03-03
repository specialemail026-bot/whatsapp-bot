import fs from "fs";
import path from "path";
import { checkAndIncrementLimit } from "../rateLimit.js";

// Resolve data directory consistently with index.js: prefer env, then host /data, then repo-local
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const PREMIUM_FILE = path.join(DATA_DIR, "premium.json");
// This array must match the one in index.js
const adminJids = [
  "192380812664956@lid",
  "261216018649199@lid",
  "145917739024404@lid"
];
const adminIds = new Set(adminJids.map((jid) => toUserId(jid)));

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
    console.log("ℹ️ DATABASE_URL not set. Using JSON premium store.");
    return null;
  }

  try {
    const { Pool } = await import("pg");
    dbPool = new Pool({
      connectionString,
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
    });

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS premium_users (
        jid TEXT PRIMARY KEY,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    console.log("✅ Postgres premium store ready.");
    return dbPool;
  } catch (err) {
    console.error("❌ Failed to initialize Postgres premium store, falling back to JSON:", err?.message || err);
    dbPool = null;
    return null;
  }
}

function loadPremium() {
  try {
    if (!fs.existsSync(PREMIUM_FILE)) {
      return {};
    }
    const data = fs.readFileSync(PREMIUM_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading premium:", err);
    return {};
  }
}

function savePremium(premium) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PREMIUM_FILE, JSON.stringify(premium, null, 2));
  } catch (err) {
    console.error("Error saving premium:", err);
  }
}

export async function isPremium(jid) {
  const rawJid = String(jid || "");
  const userId = toUserId(rawJid);
  if (!userId) return false;

  const pool = await getDbPool();
  if (pool) {
    try {
      const res = await pool.query(
        "SELECT expires_at FROM premium_users WHERE jid = $1 OR jid = $2 LIMIT 1",
        [userId, rawJid]
      );
      if (!res.rows.length) return false;
      const expiresAt = new Date(res.rows[0].expires_at).getTime();
      return expiresAt > Date.now();
    } catch (err) {
      console.error("Postgres isPremium check failed, using JSON fallback:", err?.message || err);
    }
  }

  const premium = loadPremium();
  console.log("✅ Checking premium for JID:", rawJid, "=>", userId);
  console.log("📊 Premium DB:", Object.keys(premium));

  let entry = premium[userId];

  // Backward compatibility for older key formats.
  if (!entry && premium[rawJid]) {
    entry = premium[rawJid];
    premium[userId] = entry;
    delete premium[rawJid];
    savePremium(premium);
  }

  if (!entry) {
    const legacyKey = Object.keys(premium).find((k) => toUserId(k) === userId);
    if (legacyKey) {
      entry = premium[legacyKey];
      premium[userId] = entry;
      if (legacyKey !== userId) delete premium[legacyKey];
      savePremium(premium);
    }
  }

  if (!entry) {
    console.log("❌ JID not found in premium DB");
    return false;
  }

  const now = Date.now();
  if (entry.expiresAt < now) {
    console.log("⏰ Premium expired for:", userId);
    delete premium[userId];
    savePremium(premium);
    return false;
  }
  console.log("✅ Premium ACTIVE for:", userId);
  return true;
}

export async function addPremium(jid, days = 90) {
  const rawJid = String(jid || "");
  const userId = toUserId(rawJid);
  if (!userId) throw new Error("Invalid JID for addPremium");

  const pool = await getDbPool();
  const premium = loadPremium();
  const addedAt = Date.now();
  const expiresAt = addedAt + days * 24 * 60 * 60 * 1000;

  if (pool) {
    try {
      await pool.query(
        `
        INSERT INTO premium_users (jid, added_at, expires_at)
        VALUES ($1, NOW(), TO_TIMESTAMP($2 / 1000.0))
        ON CONFLICT (jid)
        DO UPDATE SET expires_at = EXCLUDED.expires_at
        `,
        [userId, expiresAt]
      );
    } catch (err) {
      console.error("Postgres addPremium failed, writing JSON fallback:", err?.message || err);
    }
  }

  premium[userId] = { addedAt, expiresAt };
  savePremium(premium);
  console.log("💎 Premium added for:", rawJid, "=>", userId, "- Expires:", new Date(expiresAt).toISOString());
}

export async function checkLimitOrPremium(sender, type) {
  console.log(`🔍 Checking limit/premium for ${sender} (type: ${type})`);
  const senderId = toUserId(sender);
  
  // Admins are always unlimited
  if (adminIds.has(senderId)) {
    console.log("👑 Sender is ADMIN - unlimited access");
    return true;
  }

  // Premium users are unlimited
  if (await isPremium(sender)) {
    console.log("💎 Sender is PREMIUM - unlimited access");
    return true;
  }

  // Everyone else is rate-limited
  console.log("📊 Applying rate limit for:", sender);
  return checkAndIncrementLimit(sender, type);
}
