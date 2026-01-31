import axios from "axios";
import fs from "fs";
import path from "path";
import { checkLimitOrPremium } from "./premium.js";

// ===== simple in-memory locks =====
const activeChats = new Set();
const TMP_DIR = "tmp";

// ensure tmp exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR);
}

async function execute(sock, msg, args) {
  const chatId = msg.key.remoteJid;
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

    const searchUrl = `https://ef-prime-md-ultra-apis.vercel.app/search/ytsearch?query=${encodeURIComponent(query)}`;
    const searchResponse = await axios.get(searchUrl);

    if (!searchResponse.data.answer.success || !searchResponse.data.answer.videos.length) {
      activeChats.delete(chatId);
      return sock.sendMessage(
        chatId,
        { text: "❌ No results found." },
        { quoted: msg }
      );
    }

    const video = searchResponse.data.answer.videos[0];
    const safeTitle = video.title.replace(/[^\w\s.-]/g, "");
    const filePath = path.join(TMP_DIR, `${Date.now()}.mp3`);

    await sock.sendMessage(
      chatId,
      { text: `⏳ Downloading: *${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}` },
      { quoted: msg }
    );

    const downloadUrl = `https://ef-prime-md-ultra-apis.vercel.app/downloader/ytdl?url=${encodeURIComponent(video.url)}&format=mp3`;
    const downloadResponse = await axios.get(downloadUrl);

    if (!downloadResponse.data.answer.success) {
      activeChats.delete(chatId);
      return sock.sendMessage(
        chatId,
        { text: "❌ Download failed. Try again later." },
        { quoted: msg }
      );
    }

    const audioUrl = downloadResponse.data.answer.downloadUrl;
    const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(audioResponse.data);

    fs.writeFileSync(filePath, buffer);

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

export const playCommand = { execute };