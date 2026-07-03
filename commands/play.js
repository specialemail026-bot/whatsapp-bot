import axios from "axios";
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

async function convertToMp3(inputPath, outputPath) {
  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      "-y",
      "-i", inputPath,
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", "192k",
      "-ar", "44100",
      outputPath
    ]);

    let ffErr = "";
    ff.stderr.on("data", (d) => {
      ffErr += d.toString();
    });
    ff.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg failed (${code}): ${ffErr}`));
    });
    ff.on("error", reject);
  });
}

async function downloadAudioWithApi(videoUrl, inputPath) {
  const downloadUrl = `https://ef-prime-md-ultra-apis.vercel.app/downloader/ytdlv2?url=${encodeURIComponent(videoUrl)}&format=audio`;
  const downloadResponse = await axios.get(downloadUrl, { timeout: 60000 });

  if (!downloadResponse.data?.answer?.status || !downloadResponse.data?.answer?.audio_url) {
    throw new Error("Audio API did not return a usable download URL.");
  }

  const audioResponse = await axios.get(downloadResponse.data.answer.audio_url, {
    responseType: "arraybuffer",
    timeout: 120000,
    maxContentLength: 95 * 1024 * 1024,
    maxBodyLength: 95 * 1024 * 1024
  });

  fs.writeFileSync(inputPath, Buffer.from(audioResponse.data));
}

async function downloadAudioWithYtDlp(videoUrl, outputPath) {
  await new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", [
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--ffmpeg-location", ffmpegPath,
      "--no-playlist",
      "--quiet",
      "--no-warnings",
      "-o", outputPath,
      videoUrl
    ]);

    let stderr = "";
    ytdlp.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ytdlp.on("error", reject);
    ytdlp.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) return resolve();
      reject(new Error(`yt-dlp audio failed (${code}): ${stderr}`));
    });
  });
}

async function execute(sock, msg, args) {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 Play command - Sender JID:", sender);

  if (activeChats.has(chatId)) {
    return sock.sendMessage(
      chatId,
      { text: "⏳ Please wait, another song is being downloaded…" },
      { quoted: msg }
    );
  }

  if (!(await checkLimitOrPremium(sender, "play"))) {
    return sock.sendMessage(
      chatId,
      { text: "🚫 You've reached downloading limit.\n\n UPGRADE to Premium so you can download without limits for 1 month at K1,000 ONLY.\n\n📲 Withdrawal via Airtel code👉 *10249697* or TNM 089 006 1520 (Edison Chazumbwa).\n\n Contact admins at 0995551995, 0993702468, 0886219577 for help." },
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
    const inputPath = path.join(TMP_DIR, `${Date.now()}-input`);
    const outputPath = path.join(TMP_DIR, `${Date.now()}-${safeTitle}.mp3`);

    await sock.sendMessage(
      chatId,
      { text: `⏳ Downloading: *${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}` },
      { quoted: msg }
    );

    try {
      await downloadAudioWithApi(video.url, inputPath);
      await convertToMp3(inputPath, outputPath);
    } catch (apiErr) {
      console.error("PLAY API download failed, trying yt-dlp fallback:", apiErr?.code || apiErr?.message || apiErr);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      await downloadAudioWithYtDlp(video.url, outputPath);
    }

    const audioBuffer = fs.readFileSync(outputPath);

    await sock.sendMessage(
      chatId,
      {
        document: audioBuffer,
        mimetype: "audio/mpeg",
        ptt: false, // set to true for voice note style
        fileName: `${safeTitle}.mp3`
      },
      { quoted: msg }
    );

    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    activeChats.delete(chatId);

  } catch (err) {
    console.error("PLAY ERROR:", err);
    // Best-effort cleanup after failed conversion/download.
    try {
      const files = fs.readdirSync(TMP_DIR);
      const now = Date.now();
      for (const name of files) {
        if (!name.includes("-")) continue;
        const maybeTs = Number(name.split("-")[0]);
        if (Number.isFinite(maybeTs) && now - maybeTs < 10 * 60 * 1000) {
          fs.unlinkSync(path.join(TMP_DIR, name));
        }
      }
    } catch {}
    activeChats.delete(chatId);

    await sock.sendMessage(
      chatId,
      { text: "❌ Try again please." },
      { quoted: msg }
    );
  }
}

export const playCommand = { execute };
