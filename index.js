import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import { playCommand } from "./commands/play.js";
import { lyricsCommand } from "./commands/lyrics.js";
import { videoCommand } from "./commands/video.js";
import { shortCommand } from "./commands/short.js";
import { instagramCommand } from "./commands/instagram.js";
import { spotifyCommand } from "./commands/spotify.js"; 
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

const adminJids = ["265995551995@s.whatsapp.net", "265890061520@s.whatsapp.net", "192380812664956@lid"]; // Admin JIDs for premium commands

/* ===========================
   START SOCKET
   =========================== */
async function startSock() {
  const authPath = "/data/auth_info"; // persistent folder on Railway volume
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

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
        console.log("❌ Logged out. Delete auth_info and restart deployment.");
      } else {
        console.log("⚠ Connection lost. Reconnecting...");
        startSock();
      }
    }
  });

  /* ===========================
     MESSAGE HANDLER
     =========================== */
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid;

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      "";

   
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
┃ ▶️ .ping
┃ 👤 .developer
┃ 📜 .lyrics (song name)
┃ 📌 .help
┃ ✅ .status
┃ 🔒 .private
┃ 🎧 .spotify
┃ 💰 .addpremium (admin command)
┗━━━━━━━━━━━━━━━━━━━━━━┛`.trim()
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

    // ===== .private =====
    else if (body.startsWith(".private")) {
      await sock.sendMessage(chatId, {
        text:`
      Did you know you can use this AI privately in your inbox?

      ✅ No group noise
      ✅ Peaceful & fast
      ✅ Unlimited downloads
      ✅ Just you and the AI

      To own the AI privately, pay K1,000 once and use it forever.
     📩 Inbox the admin to get started.
        ` 
        }, { quoted: msg });
    }  
    
    // ===== .play =====
    else if (body.startsWith(".play")) {
      await playCommand(sock, chatId, msg);
    }

    // ===== .lyrics =====
    else if (body.startsWith(".lyrics")) {
        await lyricsCommand(sock, chatId, msg);
      }

    // ===== .video =====
    else if (body.startsWith(".video")) {
        await videoCommand(sock, chatId, msg);
      }
      
    // ===== .short =====
    else if (body.startsWith(".short")) {
        await shortCommand(sock, chatId, msg);
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