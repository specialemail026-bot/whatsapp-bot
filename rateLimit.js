import fs from "fs";
import path from "path";

const USAGE_FILE = "/data/usage.json";
const DATA_DIR = "/data";

function getToday() {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
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

export function checkAndIncrementLimit(senderJid, type) {
  // Track usage per-sender (user JID) rather than per-chat/group.
  const today = getToday();
  const usage = loadUsage();

  if (!usage[senderJid]) {
    usage[senderJid] = { date: today, songs: 0, videos: 0 };
  }

  const userUsage = usage[senderJid];

  // Reset counts when day changes
  if (userUsage.date !== today) {
    userUsage.date = today;
    userUsage.songs = 0;
    userUsage.videos = 0;
  }

  const limit = type === "song" ? 3 : 2; // Daily limits
  const current = userUsage[type + "s"]; // songs or videos

  if (current >= limit) {
    return false; // Limit reached for this sender
  }

  userUsage[type + "s"]++;
  saveUsage(usage);
  return true;
}