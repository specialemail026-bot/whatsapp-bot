# Copilot Instructions — Webs WhatsApp Bot

Purpose: get an AI coding agent productive quickly on this Baileys-based WhatsApp downloader bot.

High-level architecture
- `index.js`: single-entry router. Handles Baileys socket, QR/auth, and routing for dot-prefixed commands.
- `commands/`: command handlers. Each exports an async function (e.g. `playCommand`) and is invoked from `index.js`.
- `data/`: runtime state. `auth_info/` (Baileys creds — DO NOT EDIT), `/data/usage.json` and `/data/premium.json` (created at runtime by the code).
- `tmp/`: transient files used for downloads. Commands must clean up files.

Key patterns and conventions
- Command handler signature: `async function <name>(sock, chatId, msg)` — see `commands/play.js` and `commands/video.js`.
- Sender resolution: use `const sender = msg.key.participant || msg.key.remoteJid;` (groups have `participant`).
- Text extraction: `msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption`.
- Always reply with `{ quoted: msg }` for threading and context in responses (used everywhere in `index.js`).
- Normalize commands: `index.js` lowercases the token after the dot and normalizes spacing (e.g. `. Play` -> `.play`).

Concurrency, temp files, and safety
- Use per-chat in-memory locks to avoid duplicate work (example: `activeChats` Set in `commands/play.js`).
- Always create `tmp/` if missing and remove temporary files after sending. Use `try/finally` when possible — see `commands/play.js` for a sample flow.
- Check file size before sending large videos; `commands/video.js` enforces a ~95MB guard and deletes oversize artifacts.

Rate limits & premium
- Limits per-sender JID (not per-group): songs = 3/day, videos = 2/day. Enforced via `rateLimit.js` (`checkAndIncrementLimit`).
- Premium logic in `commands/premium.js` (`isPremium`, `addPremium`, `checkLimitOrPremium`). Premiums stored in `/data/premium.json` and expire after 30 days.
- Admin JIDs are hard-coded in `index.js` and `commands/premium.js` — keep them in sync when editing.

Dependencies & runtime
- `yt-dlp` and `ffmpeg` are invoked by command handlers (spawned child processes). Dockerfile bundles `yt-dlp`, `ffmpeg`, and Python for deployments.
- Local dev: `npm start` runs the app; first run prints a QR for Baileys and saves credentials to `data/auth_info/`.

How to add a new command
1. Create `commands/mycmd.js` exporting `async function myCmd(sock, chatId, msg)`.
2. Follow sender/text extraction and call `checkLimitOrPremium(sender, type)` when applicable.
3. Import and dispatch in `index.js` (add `else if (body.startsWith('.mycmd')) { await myCmd(sock, chatId, msg); }`).
4. Ensure temp files are created under `tmp/` and removed in `finally` blocks.

Important files to review
- Router & examples: [index.js](index.js)
- Audio example (locks + cleanup): [commands/play.js](commands/play.js)
- Video example (size guard): [commands/video.js](commands/video.js)
- Rate-limiting: [rateLimit.js](rateLimit.js)
- Premium handling: [commands/premium.js](commands/premium.js)

Do NOT edit
- `data/auth_info/` (Baileys session files). Manual edits break auth.

If anything here is unclear or you'd like me to add automated tests or CI steps, tell me which area to expand.
# WhatsApp Bot — Copilot Instructions

Purpose: Quickly onboard AI coding agents to the local Baileys-based WhatsApp bot.

Key concepts (why this layout)
- `index.js` is the single-entry router: Baileys connection, QR auth, message parsing, and a dot-prefixed command switch.
- `commands/` contains focused command handlers. Each exports an async function `handler(sock, chatId, msg)` and is invoked from `index.js`.
- `data/` persists runtime state:
  - `auth_info/` — Baileys session (DO NOT EDIT)
  - `usage.json` — per-sender daily counters (reset at UTC midnight)
  - `premium.json` — 30-day premium subscriptions
- `tmp/` stores transient downloads; handlers must clean up files.

Patterns you must follow (concrete examples)
- Command trigger: messages starting with `.` (e.g., `.play Despacito`). See `index.js` routing.
- Handler signature: `async function myCmd(sock, chatId, msg)` (see `commands/play.js`).
- Extract sender: `const sender = msg.key.participant || msg.key.remoteJid;` — limits are per sender JID.
- Extract text: `msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption`.
- Query parsing: `const query = text.split(' ').slice(1).join(' ').trim()`.
- Rate-limits: call `checkLimitOrPremium(sender, type)` from `commands/premium.js`. Types: `'song'` or `'video'`.
- Always reply with `{ quoted: msg }` for threading.

Concurrency & file safety (must-follow)
- Use the repo's `activeChats` lock pattern to avoid duplicate processing per chat (see `commands/play.js`).
- Wrap downloads and file writes in `try/finally` and remove temp files in `finally` (example in `commands/play.js`).
- Enforce video size guard (~95 MB) and delete oversize artifacts (see `commands/video.js`).

Rate limits & premium
- Song commands (`.play`, `.spotify`, `.lyrics`) → 3/day per sender; video commands (`.video`, `.short`, `.instagram`) → 2/day.
- Premium subscribers in `data/premium.json` bypass limits. Add via `.addpremium <phone|jid>` (admin-only).
- Admin JIDs are hardcoded and used by `premium.js` — keep `index.js` and `premium.js` in sync for admin control.

Adding a new command (exact steps)
1. Create `commands/mycmd.js` exporting `async function mycmd(sock, chatId, msg)`.
2. Import in `index.js` and add a `body.startsWith('.mycmd')` branch that calls your handler with `{ quoted: msg }`.
3. Follow sender/text extraction and call `checkLimitOrPremium` when applicable.

Running & deploy
- Local: `npm start` — first-run shows QR in terminal; credentials saved to `data/auth_info/`.
- Docker: `docker build -t whatsapp-bot .` (Dockerfile includes `yt-dlp`, `ffmpeg`, Python). Use Docker when host lacks binaries.

Important files to inspect
- `index.js` — router and command wiring
- `commands/play.js` — audio download + cleanup example
- `commands/video.js` — video download + size guard
- `commands/premium.js` / `rateLimit.js` — limit & premium logic
- `data/usage.json` and `data/premium.json` — runtime state models

Safe edit rules (must follow)
- Never edit `data/auth_info/`.
- Always send user-facing replies with `{ quoted: msg }`.
- Always clean `tmp/` artifacts in `finally` blocks.

If anything here is ambiguous or incomplete, tell me which command or file you want expanded and I will add precise examples.
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