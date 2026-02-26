import fs from "fs";
import path from "path";
import { Pool } from "pg";

const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const PREMIUM_FILE = path.join(DATA_DIR, "premium.json");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  if (!fs.existsSync(PREMIUM_FILE)) {
    console.log("No premium.json found at:", PREMIUM_FILE);
    return;
  }

  const raw = fs.readFileSync(PREMIUM_FILE, "utf8");
  const premium = JSON.parse(raw || "{}");
  const entries = Object.entries(premium);

  if (!entries.length) {
    console.log("premium.json is empty, nothing to migrate.");
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS premium_users (
        jid TEXT PRIMARY KEY,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    let migrated = 0;
    for (const [jid, row] of entries) {
      if (!row?.expiresAt) continue;
      const addedAtMs = Number(row.addedAt || Date.now());
      const expiresAtMs = Number(row.expiresAt);
      if (!Number.isFinite(expiresAtMs)) continue;

      await pool.query(
        `
        INSERT INTO premium_users (jid, added_at, expires_at)
        VALUES ($1, TO_TIMESTAMP($2 / 1000.0), TO_TIMESTAMP($3 / 1000.0))
        ON CONFLICT (jid)
        DO UPDATE SET
          added_at = EXCLUDED.added_at,
          expires_at = EXCLUDED.expires_at
        `,
        [jid, addedAtMs, expiresAtMs]
      );
      migrated += 1;
    }

    console.log(`Migrated ${migrated} premium user(s) to Postgres.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
