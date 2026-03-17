import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { checkLimitOrPremium } from "./premium.js";

function isUrl(text) {
  return /^https?:\/\//i.test(text);
}

function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/facebook\.com|fb\.watch/i.test(url)) return "facebook";
  if (/youtube\.com\/shorts/i.test(url)) return "youtube";
  return "generic";
}

function getFormat(platform) {
  // YouTube supports split streams
  if (platform === "youtube") {
    return `bv*[height<=480]+ba/best[height<=480]`;
  }

  // Shorts platforms use progressive MP4
  return "best";
}

export async function shortCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 SHORT command - Sender JID:", sender);

  if (!(await checkLimitOrPremium(sender, "short"))) {
    return sock.sendMessage(chatId, {
      text: "🚫 You've reached downloading limit.\n\n UPGRADE to Premium so you can download without limits for 1 month at K1,000 ONLY.\n\n📲 Withdrawal via Airtel code👉 *10249697* or TNM 089 006 1520 (Edison Chazumbwa).\n\n Contact admins at 0995551995, 0993702468, 0886219577 for help."
    }, { quoted: msg });
  }

  try {
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";

    const url = text.split(" ").slice(1).join(" ").trim();

    if (!url || !isUrl(url)) {
      return sock.sendMessage(chatId, {
        text: "📱 Usage:\n.short <tiktok / instagram / facebook / yt shorts link>"
      }, { quoted: msg });
    }

    if (!fs.existsSync("tmp")) fs.mkdirSync("tmp");

    const platform = detectPlatform(url);
    const format = getFormat(platform);

    const safeName = `${platform}_${Date.now()}`;
    const filePath = path.join("tmp", `${safeName}.mp4`);

    await sock.sendMessage(chatId, {
      text: `📥 Downloading ${platform.toUpperCase()} short...\n⏳ Please wait`
    }, { quoted: msg });

    const args = [
      "-f", format,
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
      url
    ];

    const ytdlp = spawn("yt-dlp", args);

    ytdlp.stderr.on("data", (data) => {
      console.error("yt-dlp stderr:", data.toString());
    });

    ytdlp.on("error", (err) => {
      console.error("SHORT yt-dlp spawn error:", err);
      sock.sendMessage(chatId, {
        text: `❌ Failed to download ${platform} short: ${err.message}`
      }, { quoted: msg }).catch(e => console.error("Error sending message:", e));
    });

    ytdlp.on("close", async (code) => {
      if (code !== 0) {
        console.error("yt-dlp exited with code:", code);
      }
      
      if (code !== 0 || !fs.existsSync(filePath)) {
        return sock.sendMessage(chatId, {
          text: `❌ Failed to download ${platform} short.`
        }, { quoted: msg });
      }

      try {
        const stats = fs.statSync(filePath);
        if (stats.size > 95 * 1024 * 1024) {
          fs.unlinkSync(filePath);
          return sock.sendMessage(chatId, {
            text: "⚠️ Video too large for WhatsApp."
          }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
          video: fs.readFileSync(filePath),
          mimetype: "video/mp4",
          caption: `📱 ${platform.toUpperCase()} Video`
        }, { quoted: msg });

        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Error sending short video:", err);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await sock.sendMessage(chatId, {
          text: "❌ Failed to send video."
        }, { quoted: msg });
      }
    });

  } catch (e) {
    console.error("SHORT COMMAND ERROR:", e);
    await sock.sendMessage(chatId, {
      text: "❌ Unexpected error occurred."
    }, { quoted: msg });
  }
}
