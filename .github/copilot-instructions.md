# WhatsApp Bot — AI Assistant Instructions

**Purpose**: Help AI agents be immediately productive in this Baileys-based WhatsApp bot. The bot downloads and streams media (songs, videos, reels) on demand, with daily rate limits and optional premium subscriptions.

## 1. Architecture (big picture)
- **`index.js`**: Single process entry—handles Baileys connection, QR auth, message routing, and built-in commands (`.ping`, `.help`, `.status`, `.developer`, `.private`, `.addpremium`, `.vv` for viewing disappeared messages). Route via dot-prefix switch statement.
- **`commands/`**: Self-contained modules for media downloads. Each exports `async function name(sock, chatId, msg)`. Examples: `play.js` (YouTube audio), `video.js` (YouTube video), `instagram.js`, `spotify.js`, `short.js`, `lyrics.js`. All check rate limits via `checkLimitOrPremium(sender, type)`.
- **`data/`**: Runtime persistent storage at `/data`:
  - `auth_info/` (Baileys credentials—never manually edit)
  - `usage.json` (daily per-sender limits: `{ [jid]: { date, songs, videos } }`)
  - `premium.json` (30-day subscriptions: `{ [jid]: { addedAt, expiresAt } }`)
- **`tmp/`**: Temporary media files, cleaned up via `try/finally` in each command. Created on-demand.
- **`rateLimit.js`**: Exports `checkAndIncrementLimit(senderJid, type)`. Tracks usage per sender JID, resets at UTC midnight.
- **`premium.js`**: Exports `checkLimitOrPremium(sender, type)` and `addPremium(jid)`. Checks admin JIDs, premium status, then enforces limits.
- **`Dockerfile`**: `node:20`, `ffmpeg`, `yt-dlp`, Python for all binary dependencies.

## 2. Command Patterns (how to add/modify)
- **Trigger**: Messages starting with `.` (dot). Example: `.play Despacito`.
- **Handler signature**: `async function myCommand(sock, chatId, msg)` where:
  - `sock`: Baileys socket for sending messages.
  - `chatId`: Recipient (user or group JID).
  - `msg`: WhatsApp message object containing parsed media.
- **Sender extraction** (critical for rate limiting):
  ```javascript
  const sender = msg.key.participant || msg.key.remoteJid;  // Use participant in groups, remoteJid for DMs
  ```
- **Text extraction** (standard pattern):
  ```javascript
  const text = msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption || "";
  ```
- **Query parsing**: `const query = text.split(" ").slice(1).join(" ").trim()` removes command name.
- **Rate limit check**: Call `checkLimitOrPremium(sender, type)` before processing (returns `false` if limit exceeded). Types: `"song"` or `"video"`.
- **Always reply with `{ quoted: msg }`** to preserve threading and context.
- **Registration**: Add route in `index.js` message handler switch. Include in `.help` output.

## 3. Concurrency & File Safety
- **Prevent duplicate work**: Use in-memory `Set` (e.g., `activeChats`) to lock per-chat processing. Add sender JID at start, delete in `finally`.
  ```javascript
  if (activeChats.has(chatId)) return sock.sendMessage(...);
  activeChats.add(chatId);
  try { /* work */ } finally { activeChats.delete(chatId); }
  ```
- **Temp file cleanup**: Always wrap downloads in `try/finally`. Example from `play.js`:
  ```javascript
  try {
    const filePath = path.join("tmp", `${Date.now()}.mp3`);
    // ... download to filePath ...
    await sock.sendMessage(chatId, { audio: fs.readFileSync(filePath) });
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  ```

## 4. Media Handling & Download Tools
- **Audio (MP3)**: Use `yt-dlp` with `--audio-format mp3` and `ffmpeg-static` location. `play.js` exports safe pattern.
- **Video (MP4)**: Use `yt-dlp` with resolution filter (e.g., `-f bv*[height<=480]+ba/best[height<=480]`) to stay within WhatsApp's ~95 MB soft limit. Check file size before send:
  ```javascript
  if (stats.size > 95 * 1024 * 1024) {
    fs.unlinkSync(filePath);  // Clean up before error
    return sock.sendMessage(chatId, { text: "⚠️ Video too large for WhatsApp." });
  }
  ```

## 5. Rate-Limiting & Premium (per-sender)
- **Limits** (enforced via `checkLimitOrPremium(sender, type)` from `premium.js`):
  - **Songs** (`.play`, `.spotify`, `.lyrics`): 3/day  
  - **Videos** (`.video`, `.short`, `.instagram`): 2/day
  - **Scope**: Per **sender JID** (user), not per group. `data/usage.json` tracks `{ [jid]: { date, songs, videos } }`, resets at UTC midnight.
- **Premium** (`data/premium.json`): Subscribers unlimited. Format: `{ [jid]: { addedAt, expiresAt } }` where `expiresAt = Date.now() + 30 days` in milliseconds.
  - Add via `.addpremium <phone|jid>` (admin only):
    - Phone: `.addpremium 0993287093` → auto-formats to `2650993287093@s.whatsapp.net` (Malawi country code)
    - JID: `.addpremium 185624896229398@lid` → stores as-is (linked devices use `@lid` suffix)
- **Admin JIDs** (hardcoded, must sync between `index.js` and `premium.js`): `["265995551995@s.whatsapp.net", "265890061520@s.whatsapp.net", "192380812664956@lid"]`. Only admins bypass limits and can run `.addpremium`.
- **JID formats**: Linked device users have `@lid` suffix; phone users have `@s.whatsapp.net`. Same person may access both ways with different JIDs. Check logs "Sender JID:" to debug.
- **Safe filenames**: `title.replace(/[^\w\s.-]/g, "").substring(0, 50)` prevents filesystem errors on special characters.

## 6. Adding a New Command
1. Create file `commands/mycommand.js` exporting `async function myCommandName(sock, chatId, msg)`.
2. Import in `index.js`: `import { myCommandName } from "./commands/mycommand.js"`.
3. Add route in message handler: `else if (body.startsWith(".mycommand")) { await myCommandName(sock, chatId, msg); }`.

## 7. Running & Deployment
- **Local**: `npm start` (first run displays QR code in terminal for WhatsApp auth; credentials auto-persist in `data/auth_info/`).
- **Docker**: Build with `docker build -t whatsapp-bot .` and run. Includes `yt-dlp`, `ffmpeg`, `python` out-of-the-box. Use when host lacks binaries.
- **Railway**: All data paths point to `/data` (absolute). Mount a volume at `/data` in Railway settings for persistence (`auth_info/`, `usage.json`, `premium.json`).
- **Logs**: Node runs silent logger (pino). System errors and crashes are caught globally (see top of `index.js`).

## 8. Key Files Reference
| File | Purpose |
|------|---------|
| [index.js](index.js) | Router, Baileys setup, built-in commands (`.ping`, `.alive`, `.vv`, `.addpremium`) |
| [commands/play.js](commands/play.js) | Audio download pattern: yt-dlp → ffmpeg MP3, concurrency lock, cleanup |
| [commands/video.js](commands/video.js) | Video download: yt-dlp filtered MP4, size guard (95 MB), cleanup |
| [commands/premium.js](commands/premium.js) | Premium check, 30-day subscription logic |

## 9. Safe Edit Rules
- ❌ Never modify `data/auth_info/` (Baileys session storage).
- ✅ Always include `{ quoted: msg }` in user-facing replies (preserves threading).
- ✅ Wrap temp file downloads in `try/finally`; delete artifacts before function returns.
- ❌ Avoid long-running synchronous work on event loop (use streams or spawn background processes).
- ✅ Sender JID format: `phone@s.whatsapp.net` (e.g., `265995551995@s.whatsapp.net`).
- ✅ Check `msg.key.participant` for groups; fall back to `msg.key.remoteJid` for DM.