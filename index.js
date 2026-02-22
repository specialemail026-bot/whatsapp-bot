import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import { playCommand } from "./commands/play.js";
import songCommand from "./commands/song.js";
import { lyricsCommand } from "./commands/lyrics.js";
import { videoCommand } from "./commands/video.js";
import { shortCommand } from "./commands/short.js";
import { instagramCommand } from "./commands/instagram.js";
import { spotifyCommand } from "./commands/spotify.js";
import { docCommand } from "./commands/doc.js";
import { downloadCommand } from "./commands/download.js";
import { addPremium } from "./commands/premium.js";

import P from "pino";
import qr from "qr-image";
import fs from "fs";
import { join } from "path";
import qrcode from "qrcode-terminal";

/* ===========================
   GLOBAL CRASH PROTECTION
   =========================== */
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));

const adminJids = [
  "261216018649199@lid",
  "192380812664956@lid"
]; // Admin JIDs for premium commands

/* ===========================
   START SOCKET
   =========================== */
async function startSock() {
  // Persistent auth folder — prefer `DATA_DIR` env (used in deployments),
  // otherwise prefer host-mounted `/data` if present, then fall back to
  // project-local `./data` for local development.
  const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : join(process.cwd(), "data"));
  const authPath = join(DATA_DIR, "auth_info");
  console.log("🔧 Resolved DATA_DIR:", DATA_DIR);
  console.log("🔧 Resolved auth path:", authPath);
  try {
    if (fs.existsSync(authPath)) {
      console.log("📂 existing auth_info files:", fs.readdirSync(authPath));
    } else {
      console.log("📂 auth_info directory does not exist yet (will be created by Baileys)");
    }
  } catch (e) {
    console.error("Error listing auth_path contents:", e);
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", async () => {
    try {
      console.log("💾 creds.update event — saving credentials to auth_path");
      await saveCreds();
      if (fs.existsSync(authPath)) {
        console.log("📂 auth_info files after save:", fs.readdirSync(authPath));
      }
    } catch (e) {
      console.error("Error saving creds:", e);
    }
  });

  /* ===========================
     CONNECTION HANDLER
     =========================== */
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr: qrCode } = update;

    // Only save QR if no session exists
    const sessionFile = join(authPath, "creds.json");
    if (qrCode) {
  console.log("📸 Scan this QR Code (ONLY ONCE):");
  console.log("QR Data:", qrCode);
  qrcode.generate(qrCode, { small: true });
}


    if (connection === "open") {
      console.log("✅ Webs Bot connected successfully!");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("❌ Logged out. Auto-clearing auth_info and restarting...");
        try {
          const files = fs.readdirSync(authPath);
          for (const file of files) {
            fs.unlinkSync(join(authPath, file));
          }
          console.log("✅ Auth files cleared. Restarting connection...");
        } catch (e) {
          console.error("Error clearing auth:", e);
        }
        setTimeout(() => startSock(), 2000);
      } else {
        console.log("⚠ Connection lost. Reconnecting...");
        startSock();
      }
    }
  });

  /* ===========================
   WELCOME COOLDOWN STORE
   =========================== */
const welcomeCooldown = new Map();

/*
Key   → sender JID
Value → last welcome timestamp
*/
const WELCOME_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

  /* ===========================
     MESSAGE HANDLER
     =========================== */
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid;

    const sender =
    msg.key.participant ||
    msg.key.remoteJid;

    let body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      "";

    // Normalize command input: trim, remove spaces after the dot, lowercase the command token
    // Examples handled: ". Play song" -> ".play song", ".PLAY" -> ".play"
    const raw = body.trim();
    if (raw.startsWith(".")) {
      const m = raw.match(/^\.\s*([^\s]+)([\s\S]*)$/);
      if (m) {
        const cmd = m[1].toLowerCase();
        const rest = m[2] || "";
        body = `.${cmd}${rest}`;
      } else {
        body = raw.toLowerCase();
      }
    } else {
      body = raw;
    }

    /* ===========================
   AUTO WELCOME REPLY (HARDENED)
   =========================== */

const greetings = ["hi", "hey", "hello", "hie", "yo", "sup"];
const normalized = body.toLowerCase().replace(/[!.]/g, "").trim();

if (greetings.some(g => normalized.startsWith(g))) {

  const now = Date.now();
  const last = welcomeCooldown.get(sender);

  // Cooldown gate
  if (last && (now - last) < WELCOME_COOLDOWN_MS) {
    return; // Silently ignore
  }

  // Update timestamp BEFORE sending (prevents race spam)
  welcomeCooldown.set(sender, now);

  await sock.sendMessage(chatId, {
    text: `Welcome to Webs AI 🤖

Here I will download for you:
YouTube / TikTok / Facebook / Instagram videos,
songs, documents provided you write commands correctly.

🎵 Songs
.song (song name)

🎬 YouTube Videos
.video (video title)

📱 Short Videos (TikTok / Reels / Shorts)
.short (video_link_here)

📚 Documents / Books
.doc (doc_link_here)

📝 Lyrics
.lyrics (song name)

📋 To view all available Commands
.help

Note: Its recommended to remove brackets when typing commands.

Downloading made easy 🔥`
  }, { quoted: msg });

  return;
}
   
    // ===== .ping =====
    if (body.startsWith(".ping")) {
      await sock.sendMessage(chatId, {
        text: `╭─「 *Webs AI STATUS* 」
│⚡ Speed: Fast
│🟢 Status: Online
╰─────────────`
      }, { quoted: msg });
    }

    // ===== .help =====
    else if (body.startsWith(".help")) {
      await sock.sendMessage(chatId, {
        text: `
┏━━〔 *Webs AI Commands* 〕━━┓
┃ 🎵 .play (song name)
┃ 🎥 .video (video title)
┃ 📱 .short (video link)
┃ 📸 .instagram (video link)
┃ 🔒 .private
┃ 🎧 .song (song name)
┃ 👤 .developer
┃ 📁 .doc (document link)
┃ 💎 .upgrade
┃ 📜 .lyrics (song name)
┃ 📌 .help
┃ ✅ .status
┃ ▶️ .ping
┃ 💰 .addpremium (for admin)
┗━━━━━━━━━━━━━━━━━━━━━━
  WEBS AI VERSION 1.0
┗━━━━━━━━━━━━━━━━━━━━━━
`.trim()
      }, { quoted: msg });
    }

    // ===== .status =====
    else if (body.startsWith(".status")) {
      await sock.sendMessage(chatId, {
        text: "✅ Webs AI is ONLINE"
      }, { quoted: msg });
    }

    // ===== .developer =====
    else if (body.startsWith(".developer")) {
      await sock.sendMessage(chatId, {
        text: "Developed by Webs, Infor Systems student at UNIMA\n📞 099 555 1995\n📩 specialmail033@gmail.com"
      }, { quoted: msg });
    }

    // ===== .upgrade =====
    else if (body.startsWith(".upgrade")) {
      await sock.sendMessage(chatId, {
        text: "Are you a free user??\n\n📲 Upgrade by paying K1,000 once and download content without limits.\n\n📲 Contact the developer at 0995551995 / 0889964091 for full info."
      }, { quoted: msg });
    }

    // ===== .private =====
    else if (body.startsWith(".private")) {
      await sock.sendMessage(chatId, {
        text:`
Did you know you can use this AI privately in your inbox?

  ✅ No group noise
  ✅ Peaceful & fast
  ✅ Unlimited downloads
  ✅ Just you and the AI

To use the AI privately, pay K1,000 once and use it forever.
📩 Inbox the admin to get started.
        ` 
        }, { quoted: msg });
    }  

    // ===== .play =====
    else if (body.startsWith(".play")) {
      const args = body.split(" ").slice(1);
      await playCommand.execute(sock, msg, args);
    }

    // ===== .doc =====
    else if (body.startsWith(".doc")) {
        await docCommand(sock, chatId, msg);
      }

    // ===== .lyrics =====
    else if (body.startsWith(".lyrics")) {
        await lyricsCommand(sock, chatId, msg);
      }

    // ===== .video =====
    else if (body.startsWith(".video")) {
        await videoCommand(sock, chatId, msg);
      }
      
    // ===== .download =====
    else if (body.startsWith(".download")) {
      await downloadCommand(sock, chatId, msg);
    }
    // ===== .short =====
    else if (body.startsWith(".short")) {
        await shortCommand(sock, chatId, msg);
      }

    // ===== .song =====
    else if (body.startsWith(".song")) {
      const args = body.split(" ").slice(1);
      await songCommand.execute(sock, msg, args);
    }

    // ===== .instagram =====
    else if (body.startsWith(".instagram")) {
        await instagramCommand(sock, chatId, msg);
      }

    // ===== .spotify =====
    else if (body.startsWith(".spotify")) {
        await spotifyCommand(sock, chatId, msg);
      }

    // ===== .addpremium =====
    else if (body.startsWith(".addpremium")) {
  const sender =
  msg.key.participant ||
  msg.participant ||
  msg.message?.extendedTextMessage?.contextInfo?.participant;

  console.log("Sender JID (resolved):", sender);

if (!sender || !adminJids.includes(sender)) {
  return sock.sendMessage(
    chatId,
    { text: "❌ Admin only command." },
    { quoted: msg }
  );
}
  const args = body.split(" ").slice(1);
  if (args.length !== 1) {
    return sock.sendMessage(
      chatId,
      { text: "Usage: .addpremium <phone_number|jid>\nExamples:\n.addpremium 0993287093\n.addpremium 185624896229398@lid" },
      { quoted: msg }
    );
  }

  let jid;
  const input = args[0];
  
  // Check if input is already a full JID (contains @)
  if (input.includes("@")) {
    jid = input; // Use as-is
  } else {
    // Treat as phone number and format it
    const phone = input.replace(/\D/g, "");
    const country = "265";
    const fullPhone = phone.startsWith(country) ? phone : country + phone;
    jid = `${fullPhone}@s.whatsapp.net`;
  }

  addPremium(jid);

  await sock.sendMessage(
    chatId,
    { text: `✅ You have Upgraded ${jid} ` },
    { quoted: msg }
  );
 }

   // ===== .vv =====
    else if (body.startsWith(".vv")) {
      const quoted =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      if (!quoted) {
        return sock.sendMessage(chatId, {
          text: "❗ Reply to a ViewOnce image/video."
        }, { quoted: msg });
      }

      try {
        const buffer = await downloadMediaMessage(
          { message: quoted },
          "buffer",
          {},
          { logger: P({ level: "silent" }) }
        );

        await sock.sendMessage(chatId, {
          image: buffer,
          caption: "👁 ViewOnce revealed"
        }, { quoted: msg });

      } catch {
        await sock.sendMessage(chatId, {
          text: "❌ Failed to reveal media."
        }, { quoted: msg });
      }
    }
  });
}

startSock();