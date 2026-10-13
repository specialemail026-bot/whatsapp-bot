import axios from "axios";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { checkLimitOrPremium } from "./premium.js";
import { queueYouTubeDownload, retryTransient } from "./youtubeDownloadQueue.js";
import { withYtDlpCookies } from "./ytDlpCookies.js";

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
  const args = [
    "-x",
    "-f", "bestaudio/best",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--ffmpeg-location", ffmpegPath,
    "--no-playlist",
    "--js-runtimes", "node",
    "--quiet",
    "-o", outputPath
  ];
  args.push(videoUrl);

  await withYtDlpCookies(args, () => new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", args);

    let stderr = "";
    ytdlp.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ytdlp.on("error", reject);
    ytdlp.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) return resolve();
      reject(new Error(`yt-dlp audio failed (${code}): ${stderr}`));
    });
  }));
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

  let requestId;
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
    requestId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = path.join(TMP_DIR, `${requestId}-input`);
    const outputPath = path.join(TMP_DIR, `${requestId}-${safeTitle}.mp3`);

    await sock.sendMessage(
      chatId,
      { text: `⏳ Downloading: *${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}` },
      { quoted: msg }
    );

    await queueYouTubeDownload(async () => {
      try {
        await retryTransient(() => downloadAudioWithApi(video.url, inputPath), "PLAY API");
        await convertToMp3(inputPath, outputPath);
      } catch (apiErr) {
        console.error("PLAY API download failed, trying yt-dlp fallback:", apiErr?.code || apiErr?.message || apiErr);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        await retryTransient(
          () => downloadAudioWithYtDlp(video.url, outputPath),
          "PLAY yt-dlp"
        );
      }
    });

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
    // Clean only this request's files so concurrent downloads are untouched.
    try {
      if (requestId) {
        const failedFilePrefix = `${requestId}-`;
        for (const name of fs.readdirSync(TMP_DIR)) {
          if (name.startsWith(failedFilePrefix)) fs.unlinkSync(path.join(TMP_DIR, name));
        }
      }
    } catch (cleanupErr) {
      console.error("PLAY cleanup error:", cleanupErr?.message || cleanupErr);
    }
    activeChats.delete(chatId);

    const errorText = String(err?.message || err);
    const blockedByYouTube = /not a bot|sign in to confirm/i.test(errorText);
    const noAvailableFormat = /requested format is not available/i.test(errorText);
    const replyText = blockedByYouTube
      ? "YouTube is blocking requests from the bot server. The operator needs to configure valid yt-dlp cookies (YTDLP_COOKIES_BASE64 or YTDLP_COOKIES_FILE). Please try again later."
      : noAvailableFormat
        ? "YouTube did not provide a downloadable audio format for that song. Please try another song or try again later."
        : "The song download failed. Please try again later.";

    await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });
  }
}

export const playCommand = { execute };
