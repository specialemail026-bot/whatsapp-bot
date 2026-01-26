import fs from "fs";
import path from "path";
import { checkAndIncrementLimit } from "../rateLimit.js";

// Resolve data directory consistently with index.js: prefer env, then host /data, then repo-local
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const PREMIUM_FILE = path.join(DATA_DIR, "premium.json");
// This array must match the one in index.js
const adminJids = [
  "265995551995@s.whatsapp.net",
  "265890061520@s.whatsapp.net",
  "192380812664956@lid"
];

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

export function isPremium(jid) {
  const premium = loadPremium();
  console.log("✅ Checking premium for JID:", jid);
  console.log("📊 Premium DB:", Object.keys(premium));
  
  if (!premium[jid]) {
    console.log("❌ JID not found in premium DB");
    return false;
  }

  const now = Date.now();
  if (premium[jid].expiresAt < now) {
    console.log("⏰ Premium expired for:", jid);
    delete premium[jid];
    savePremium(premium);
    return false;
  }
  console.log("✅ Premium ACTIVE for:", jid);
  return true;
}

export function addPremium(jid) {
  const premium = loadPremium();
  const addedAt = Date.now();
  const expiresAt = addedAt + 30 * 24 * 60 * 60 * 1000; // 30 days
  premium[jid] = { addedAt, expiresAt };
  savePremium(premium);
  console.log("💎 Premium added for:", jid, "- Expires:", new Date(expiresAt).toISOString());
}

export function checkLimitOrPremium(sender, type) {
  console.log(`🔍 Checking limit/premium for ${sender} (type: ${type})`);
  
  // Admins are always unlimited
  if (adminJids.includes(sender)) {
    console.log("👑 Sender is ADMIN - unlimited access");
    return true;
  }

  // Premium users are unlimited
  if (isPremium(sender)) {
    console.log("💎 Sender is PREMIUM - unlimited access");
    return true;
  }

  // Everyone else is rate-limited
  console.log("📊 Applying rate limit for:", sender);
  return checkAndIncrementLimit(sender, type);
}
