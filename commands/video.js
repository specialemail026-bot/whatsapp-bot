import yts from "yt-search";
import fs from "fs";
import path from "path";
import axios from "axios";
import { spawn } from "child_process";
import { checkLimitOrPremium } from "./premium.js";

const MAX_VIDEO_SIZE = 95 * 1024 * 1024;

function cleanup(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error("VIDEO cleanup error:", err?.message || err);
  }
}

async function downloadStreamToFile(url, filePath) {
  const videoResponse = await axios({
    method: "get",
    url,
    responseType: "stream",
    timeout: 120000,
    maxContentLength: MAX_VIDEO_SIZE,
    maxBodyLength: MAX_VIDEO_SIZE
  });

  const writer = fs.createWriteStream(filePath);
  videoResponse.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
    videoResponse.data.on("error", reject);
  });
}

async function downloadWithYtDlp(url, filePath) {
  await new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", [
      "-f", "best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "--quiet",
      "--no-warnings",
      "--socket-timeout", "30",
      "--retries", "3",
      "-o", filePath,
      url
    ]);

    let stderr = "";
    ytdlp.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ytdlp.on("error", reject);
    ytdlp.on("close", (code) => {
      if (code === 0 && fs.existsSync(filePath)) return resolve();
      reject(new Error(`yt-dlp failed (${code}): ${stderr}`));
    });
  });
}

export async function videoCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 VIDEO command - Sender JID:", sender);

  if (!(await checkLimitOrPremium(sender, "video"))) {
    return sock.sendMessage(chatId, {
      text: "🚫 You've reached downloading limit.\n\n UPGRADE to Premium so you can download without limits for 1 month at K1,000 ONLY.\n\n📲 Withdrawal via Airtel code👉 *10249697* or TNM 089 006 1520 (Edison Chazumbwa).\n\n Contact admins at 0995551995, 0993702468, 0886219577 for help."
    }, { quoted: msg });
  }

  let inputPath = "";

  try {
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";

    const query = text.split(" ").slice(1).join(" ").trim();
    if (!query) {
      return sock.sendMessage(chatId, {
        text: "🎬 Usage: .video song name"
      }, { quoted: msg });
    }

    const search = await yts(query);
    if (!search.videos.length) {
      return sock.sendMessage(chatId, {
        text: "❌ No video results found."
      }, { quoted: msg });
    }

    const video = search.videos[0];

    // Temp folder safety
    if (!fs.existsSync("tmp")) fs.mkdirSync("tmp");

    const safeTitle = video.title.replace(/[^\w\s]/gi, "").substring(0, 50);
    inputPath = path.join("tmp", `${Date.now()}-${safeTitle}-input.mp4`);

    await sock.sendMessage(chatId, {
      text: `🎬 Downloading video:\n*${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}\n\n⏳ Please wait...`
    }, { quoted: msg });

    // Build API URL with the video URL
    const encodedUrl = encodeURIComponent(video.url);
    const apiUrl = `https://ef-prime-md-ultra-apis.vercel.app/downloader/ytdlv2?url=${encodedUrl}&format=video`;

    console.log("🔗 Fetching video info from API:", apiUrl);

    // Fetch video download URLs from API
    const apiResponse = await axios.get(apiUrl, {
      timeout: 60000 // 60 second timeout
    });

    if (!apiResponse.data?.answer?.status) {
      return sock.sendMessage(chatId, {
        text: "❌ Failed to fetch video download link."
      }, { quoted: msg });
    }

    const videoData = apiResponse.data.answer;
    
    // Prefer the ready MP4 URL. Re-encoding video with ffmpeg is too heavy for
    // small Railway instances and can crash the command.
    const downloadUrl =
      videoData.video_url ||
      (videoData.video_url_hd !== "No SD video URL available" ? videoData.video_url_hd : null);

    if (!downloadUrl) {
      return sock.sendMessage(chatId, {
        text: "❌ No video download URL available."
      }, { quoted: msg });
    }

    console.log("⬇️ Downloading video from:", downloadUrl);

    try {
      await downloadStreamToFile(downloadUrl, inputPath);
    } catch (downloadErr) {
      cleanup(inputPath);
      console.error("VIDEO API download failed, trying yt-dlp fallback:", downloadErr?.code || downloadErr?.message || downloadErr);
      await downloadWithYtDlp(video.url, inputPath);
    }

    const stats = fs.statSync(inputPath);

    // WhatsApp/Railway free-tier guard.
    if (stats.size > MAX_VIDEO_SIZE) {
      cleanup(inputPath);
      return sock.sendMessage(chatId, {
        text: "⚠️ Video too large for WhatsApp.\nTry a shorter video."
      }, { quoted: msg });
    }

    console.log("✅ Video downloaded successfully, size:", stats.size);

    // Send as document to preserve downloadable file and avoid local video
    // transcoding on memory-limited hosts.
    await sock.sendMessage(chatId, {
      document: fs.readFileSync(inputPath),
      mimetype: "video/mp4",
      fileName: `${videoData.title || video.title}.mp4`,
      caption: `🎬 ${videoData.title || video.title}`
    }, { quoted: msg });

    cleanup(inputPath);

  } catch (e) {
    cleanup(inputPath);
    console.error("VIDEO ERROR:", e);
    
    // Specific error messages
    let errorMsg = "❌ Unexpected error occurred.";
    if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
      errorMsg = "Download timeout. The video might be too large or the server is slow.";
    } else if (e.response?.status) {
      errorMsg = `❌ API Error: ${e.response.status} - ${e.response.statusText}`;
    }
    
    await sock.sendMessage(chatId, {
      text: errorMsg
    }, { quoted: msg });
  }
}
