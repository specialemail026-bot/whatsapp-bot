import yts from "yt-search";
import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import { checkLimitOrPremium } from "./premium.js";

export async function videoCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 VIDEO command - Sender JID:", sender);

  if (!checkLimitOrPremium(sender, "video")) {
    return sock.sendMessage(chatId, {
      text: "🚫 You've reached limit.\n\n Pay K1,000 once and download forever without limits.\n\n📲 099 555 1995 or 088 996 4091 (Edison Chazumbwa)."
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
    const filePath = path.join("tmp", `${Date.now()}-${safeTitle}.mp4`);

    await sock.sendMessage(chatId, {
      text: `🎬 Downloading video:\n*${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}\n\n⏳ Please wait...`
    }, { quoted: msg });

    // yt-dlp args (WhatsApp-safe resolution)
    const args = [
      "-f", "bv*[height<=480]+ba/best[height<=480]",
      "--merge-output-format", "mp4",
      "--ffmpeg-location", ffmpegPath,
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "--add-header",
      "Accept-Language:en-US,en;q=0.9",
      "--extractor-args",
      "youtube:player_client=web",
      "--socket-timeout", "30",
      "--retries", "5",
      "--fragment-retries", "5",
      "-o", filePath,
      video.url
    ];

    const ytdlp = spawn("yt-dlp", args);

    ytdlp.stderr.on("data", (data) => {
      console.error("yt-dlp stderr:", data.toString());
    });

    ytdlp.on("error", (err) => {
      console.error("VIDEO yt-dlp spawn error:", err);
      sock.sendMessage(chatId, {
        text: "❌ Video download failed: " + err.message
      }, { quoted: msg }).catch(e => console.error("Error sending message:", e));
    });

    ytdlp.on("close", async (code) => {
      if (code !== 0) {
        console.error("yt-dlp exited with code:", code);
      }
      
      if (code !== 0 || !fs.existsSync(filePath)) {
        return sock.sendMessage(chatId, {
          text: "❌ Video download failed."
        }, { quoted: msg });
      }

      try {
        const stats = fs.statSync(filePath);

        // WhatsApp limit guard (~100MB)
        if (stats.size > 95 * 1024 * 1024) {
          fs.unlinkSync(filePath);
          return sock.sendMessage(chatId, {
            text: "⚠️ Video too large for WhatsApp.\nTry a shorter video."
          }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
          video: fs.readFileSync(filePath),
          mimetype: "video/mp4",
          caption: `🎬 ${video.title}`
        }, { quoted: msg });

        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Error sending video:", err);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await sock.sendMessage(chatId, {
          text: "❌ Failed to send video file."
        }, { quoted: msg });
      }
    });

  } catch (e) {
    console.error("VIDEO ERROR:", e);
    await sock.sendMessage(chatId, {
      text: "❌ Unexpected error occurred."
    }, { quoted: msg });
  }
}
