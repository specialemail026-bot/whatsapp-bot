# Copilot Instructions — Webs WhatsApp Bot

**Purpose**: Onboard AI agents to this Baileys-based WhatsApp media downloader bot. Downloads songs, videos, and reels on demand with rate limits and premium subscriptions.

## Architecture

- **`index.js`**: Single router. Handles Baileys connection, QR auth, message parsing, command normalization (lowercases `.Play` → `.play`), and `else if` routing for dot-prefixed commands. Built-in commands: `.ping`, `.help`, `.status`, `.developer`, `.upgrade`, `.private`, `.addpremium`, `.vv` (view disappeared media).
- **`commands/`**: Command handlers—each file exports `async function name(sock, chatId, msg)`. Examples: `play.js` (YouTube audio), `video.js` (YouTube video), `instagram.js`, `spotify.js`, `short.js`, `lyrics.js`, `doc.js`. All enforce rate limits via `checkLimitOrPremium()`.
- **`data/`**: Persistent runtime state—**never manually edit `auth_info/`** (Baileys session):
  - `usage.json`: `{ [jid]: { date, songs, videos } }` — daily per-sender counters, reset at UTC midnight.
  - `premium.json`: `{ [jid]: { addedAt, expiresAt } }` — 30-day subscriptions.
- **`tmp/`**: Transient downloads. Commands create and **must delete in `finally` blocks** to avoid disk bloat.
- **`rateLimit.js`**: Exports `checkAndIncrementLimit(jid, type)` — checks limits, resets daily.
- **`premium.js`**: Exports `checkLimitOrPremium(sender, type)` (checks admin/premium first, then limit), `addPremium(jid)`, `isPremium(jid)`.

## Command Patterns (must follow exactly)

**Handler signature:**
```javascript
export async function myCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;  // Groups use participant
  const text = msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption || "";
  const query = text.split(" ").slice(1).join(" ").trim();  // Remove command
}
```

**Routing in `index.js`:**
```javascript
else if (body.startsWith(".mycommand")) {
  await myCommand(sock, chatId, msg);
}
```

**Rate-limit enforcement** (before main work):
```javascript
if (!checkLimitOrPremium(sender, "song")) {  // Types: "song" or "video"
  return sock.sendMessage(chatId, { text: "Limit reached." }, { quoted: msg });
}
```

**Always reply with `{ quoted: msg }`** to thread messages.

## Concurrency & File Safety

- **Prevent duplicate work per chat** using in-memory `Set`:
  ```javascript
  const activeChats = new Set();
  if (activeChats.has(chatId)) return sock.sendMessage(...);
  activeChats.add(chatId);
  try { /* work */ } finally { activeChats.delete(chatId); }
  ```
- **Clean temp files in `finally`**:
  ```javascript
  try {
    const filePath = path.join("tmp", `${Date.now()}.mp3`);
    // Download/process...
    await sock.sendMessage(chatId, { audio: fs.readFileSync(filePath) }, { quoted: msg });
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  ```
- **Video size guard** (~95 MB WhatsApp limit):
  ```javascript
  if (stats.size > 95 * 1024 * 1024) {
    fs.unlinkSync(filePath);
    return sock.sendMessage(chatId, { text: "⚠️ Video too large." }, { quoted: msg });
  }
  ```

## Rate Limits & Premium

- **Daily limits per sender JID** (not per group):
  - Songs (`.play`, `.spotify`, `.lyrics`): **3/day**
  - Videos (`.video`, `.short`, `.instagram`): **2/day**
- **Premium users** (in `premium.json`): Unlimited. Expire after 30 days.
- **Admin JIDs** (hardcoded, must match between `index.js` and `commands/premium.js`):
  ```javascript
  ["265995551995@s.whatsapp.net", "265890061520@s.whatsapp.net", "192380812664956@lid"]
  ```
  Admins bypass limits and can run `.addpremium <phone|jid>`. Sync when editing.
- **JID formats**: Phone users → `phone@s.whatsapp.net` (e.g., `265995551995@s.whatsapp.net`); linked device users → `userid@lid`. Same person may have both. Check logs "Sender JID:" to debug.
- **`.addpremium` usage** (admin only):
  - Phone: `.addpremium 0993287093` → formats to `2650993287093@s.whatsapp.net` (country code 265 prepended).
  - JID: `.addpremium 185624896229398@lid` → stored as-is.

## Data Directory Resolution

**⚠️ INCONSISTENCY ALERT**: `index.js` hardcodes `const DATA_DIR = "/data"`, but `premium.js` and `rateLimit.js` use the flexible fallback:
```javascript
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
```

**For new code**: Always use the fallback pattern above to support local dev (creates `data/` repo-locally), Docker (`/data` volume), and Railway/Cloud (env override). When fixing `index.js`, update it to match `premium.js` and `rateLimit.js`.

## Adding a New Command

1. Create `commands/mycmd.js` exporting `async function myCmd(sock, chatId, msg)`.
2. Import at top of `index.js`: `import { myCmd } from "./commands/mycmd.js"`.
3. Add route in message handler: `else if (body.startsWith(".mycmd")) { await myCmd(sock, chatId, msg); }`.
4. Add help text to `.help` command response if user-facing.
5. Extract sender, text, and query using patterns above; call `checkLimitOrPremium()` before processing.
6. Create `tmp/` files, wrap in `try/finally`, delete on exit.

## Running & Deployment

- **Local**: `npm start` — prints QR on first run for Baileys auth; credentials saved to `data/auth_info/`.
- **Docker**: `docker build -t whatsapp-bot .` bundles `yt-dlp`, `ffmpeg`, Python. Use when host lacks binaries.
- **Railway/Cloud**: Set `DATA_DIR=/data` (or use default fallback). Mount volume at `/data` for persistence.
- **Logging**: Pino logger set to silent; global crash handlers at top of `index.js` catch `uncaughtException` and `unhandledRejection` to prevent bot shutdown.
- **Per-command try/catch**: Always wrap download work in `try/catch` and reply with error message; finally block cleans temp files. Index.js has global handler as fallback.

## Key Files

| File | Purpose |
|------|---------|
| [index.js](index.js) | Router, Baileys setup, command normalization, built-in commands |
| [commands/play.js](commands/play.js) | Audio download (yt-dlp → ffmpeg MP3), concurrency lock, cleanup |
| [rateLimit.js](rateLimit.js) | Daily usage tracking per sender JID, UTC midnight reset |
| [commands/premium.js](commands/premium.js) | Admin/premium checks, 30-day subscription logic |
| [Dockerfile](Dockerfile) | Node 20, `yt-dlp`, `ffmpeg`, Python |

## Safe Edit Rules

- ❌ Never manually edit `data/auth_info/` — breaks Baileys authentication.
- ✅ Always include `{ quoted: msg }` in replies (preserves threading).
- ✅ Clean `tmp/` artifacts in `finally` blocks before function returns.
- ✅ Wrap child process spawns (`yt-dlp`, `ffmpeg`) in try/catch + finally for cleanup.
- ✅ Keep admin JIDs in sync between `index.js` and `commands/premium.js`.
- ✅ Use safe filename sanitization: `title.replace(/[^\w\s.-]/g, "").substring(0, 50)`.
