import yts from "yt-search";
import fs from "fs";
import path from "path";
import axios from "axios";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { checkLimitOrPremium } from "./premium.js";

export async function videoCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 VIDEO command - Sender JID:", sender);

  if (!(await checkLimitOrPremium(sender, "video"))) {
    return sock.sendMessage(chatId, {
      text: "🚫 You've reached limit.\n\n Pay K1,000 once and download without limits.\n\n📲 099 555 1995 or 088 996 4091 (Edison Chazumbwa)."
    }, { quoted: msg });
  }

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
    const inputPath = path.join("tmp", `${Date.now()}-${safeTitle}-input`);
    const outputPath = path.join("tmp", `${Date.now()}-${safeTitle}.mp4`);

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
    
    // Prefer HD, fallback to regular video_url
    const downloadUrl = videoData.video_url_hd !== "No SD video URL available" 
      ? videoData.video_url_hd 
      : videoData.video_url;

    if (!downloadUrl) {
      return sock.sendMessage(chatId, {
        text: "❌ No video download URL available."
      }, { quoted: msg });
    }

    console.log("⬇️ Downloading video from:", downloadUrl);

    // Download the video file
    const videoResponse = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream',
      timeout: 120000, // 2 minute timeout for download
      maxContentLength: 100 * 1024 * 1024, // 100MB limit
      maxBodyLength: 100 * 1024 * 1024
    });

    const writer = fs.createWriteStream(inputPath);
    videoResponse.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const stats = fs.statSync(inputPath);

    // WhatsApp limit guard (~100MB)
    if (stats.size > 95 * 1024 * 1024) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      return sock.sendMessage(chatId, {
        text: "⚠️ Video too large for WhatsApp.\nTry a shorter video."
      }, { quoted: msg });
    }

    console.log("✅ Video downloaded successfully, size:", stats.size);

    // Normalize source to WhatsApp-friendly MP4 (H.264 video + AAC audio).
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, [
        "-y",
        "-i", inputPath,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
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

    const outStats = fs.statSync(outputPath);
    if (outStats.size > 95 * 1024 * 1024) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      return sock.sendMessage(chatId, {
        text: "⚠️ Converted video is too large for WhatsApp.\nTry a shorter video."
      }, { quoted: msg });
    }

    // Send as document to preserve downloadable file with correct codec/container.
    await sock.sendMessage(chatId, {
      document: fs.readFileSync(outputPath),
      mimetype: "video/mp4",
      fileName: `${videoData.title || video.title}.mp4`,
      caption: `🎬 ${videoData.title || video.title}`
    }, { quoted: msg });

    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  } catch (e) {
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
