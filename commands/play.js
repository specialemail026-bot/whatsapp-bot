import yts from "yt-search";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { checkLimitOrPremium } from "./premium.js";

// ===== simple in-memory locks =====
const activeChats = new Set();
const TMP_DIR = "tmp";

// ensure tmp exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR);
}

export async function playCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 PLAY command - Sender JID:", sender);

  if (activeChats.has(chatId)) {
    return sock.sendMessage(
      chatId,
      { text: "⏳ Please wait, another song is being downloaded…" },
      { quoted: msg }
    );
  }

  if (!checkLimitOrPremium(sender, chatId, "song")) {
    return sock.sendMessage(
      chatId,
      { text: "🚫 You've reached limit.\n\n Pay K1,000 once and download forever without limits.\n\n📲 099 555 1995 or 088 996 4091 (Edison Chazumbwa)." },
      { quoted: msg }
    );
  }

  activeChats.add(chatId);

  try {
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";

    const query = text.split(" ").slice(1).join(" ").trim();
    if (!query) {
      activeChats.delete(chatId);
      return sock.sendMessage(
        chatId,
        { text: "🎵 Usage: .play song name" },
        { quoted: msg }
      );
    }

    const search = await yts(query);
    if (!search.videos.length) {
      activeChats.delete(chatId);
      return sock.sendMessage(
        chatId,
        { text: "❌ No results found." },
        { quoted: msg }
      );
    }

    const video = search.videos[0];
    const safeTitle = video.title.replace(/[^\w\s.-]/g, "");
    const filePath = path.join(TMP_DIR, `${Date.now()}.mp3`);

    await sock.sendMessage(
      chatId,
      { text: `⏳ Downloading: *${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}` },
      { quoted: msg }
    );

    const args = [
      "-x",
      "--audio-format",
      "mp3",
      "--ffmpeg-location",
      ffmpegPath,
      "--quiet",
      "-o",
      filePath,
      video.url
    ];

    const ytdlp = spawn("yt-dlp", args);

    ytdlp.on("error", (err) => {
      console.error("yt-dlp spawn error:", err);
    });

    ytdlp.on("close", async (code) => {
      if (code !== 0 || !fs.existsSync(filePath)) {
        activeChats.delete(chatId);
        return sock.sendMessage(
          chatId,
          { text: "❌ Download failed. Try again later." },
          { quoted: msg }
        );
      }

      const buffer = fs.readFileSync(filePath);

      await sock.sendMessage(
        chatId,
        {
          document: buffer,
          mimetype: "audio/mpeg",
          fileName: `${safeTitle}.mp3`
        },
        { quoted: msg }
      );

      fs.unlinkSync(filePath);
      activeChats.delete(chatId);
    });

  } catch (err) {
    console.error("PLAY ERROR:", err);
    activeChats.delete(chatId);

    await sock.sendMessage(
      chatId,
      { text: "❌ Unexpected error occurred." },
      { quoted: msg }
    );
  }
}
