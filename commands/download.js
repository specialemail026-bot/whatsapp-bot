import yts from "yt-search";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ytdl from "ytdl-core";
import { checkLimitOrPremium } from "./premium.js";

const activeChats = new Set();
const TMP_DIR = "tmp";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

export async function downloadCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;

  if (activeChats.has(chatId)) {
    return sock.sendMessage(chatId, { text: "⏳ Please wait, another song is being downloaded…" }, { quoted: msg });
  }

  if (!(await checkLimitOrPremium(sender, "song"))) {
    return sock.sendMessage(chatId, { text: "🚫 You've reached downloading limit.\n\n UPGRADE to Premium so you can download without limits for 1 month at K1,000 ONLY.\n\n📲 Withdrawal via Airtel code👉 *10249697* or TNM 089 006 1520 (Edison Chazumbwa).\n\n Contact admins at 0995551995, 0993702468, 0886219577 for help." }, { quoted: msg });
  }

  activeChats.add(chatId);

  try {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    const query = text.split(" ").slice(1).join(" ").trim();
    if (!query) {
      activeChats.delete(chatId);
      return sock.sendMessage(chatId, { text: "🎵 Usage: .download song name" }, { quoted: msg });
    }

    const search = await yts(query);
    if (!search?.videos?.length) {
      activeChats.delete(chatId);
      return sock.sendMessage(chatId, { text: "❌ No results found." }, { quoted: msg });
    }

    const video = search.videos[0];
      const safeTitle = video.title.replace(/[^\w\s.\-]/g, "");

    await sock.sendMessage(chatId, { text: `⏳ Downloading: *${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}` }, { quoted: msg });

    // Primary approach: stream bestaudio from yt-dlp into ffmpeg and produce mp3
    const ytArgs = [
      video.url,
      "-f",
      "bestaudio/best",
      "-o",
      "-",
      "--no-playlist",
      "--quiet",
      "--no-warnings",
      "--no-check-certificate",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36"
    ];

    const ffArgs = [
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-ar', '44100',
      '-f', 'mp3',
      'pipe:1'
    ];

    const yt = spawn('yt-dlp', ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const ff = spawn(ffmpegPath, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    yt.stdout.pipe(ff.stdin);

    let stderr = '';
    yt.stderr?.on('data', (d) => { stderr += d.toString(); });
    ff.stderr?.on('data', (d) => { stderr += d.toString(); });

    const chunks = [];
    for await (const chunk of ff.stdout) chunks.push(chunk);

    // Wait for processes to close
    await new Promise((resolve) => {
      ff.on('close', () => resolve());
      yt.on('close', () => resolve());
    });

    if (!chunks.length) {
      console.error('Download pipeline failed:', stderr);

      // If yt-dlp returned 403, try a Node-native fallback using ytdl-core
      if (/HTTP Error 403|403 Forbidden|403/.test(stderr)) {
        try {
          console.log('Attempting ytdl-core fallback...');
          const ytdlStream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });

          const ff2 = spawn(ffmpegPath, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
          ytdlStream.pipe(ff2.stdin);

          let ff2err = '';
          ff2.stderr?.on('data', (d) => { ff2err += d.toString(); });

          const chunks2 = [];
          for await (const c of ff2.stdout) chunks2.push(c);

          await new Promise((res) => ff2.on('close', res));

          if (chunks2.length) {
            const audioBuffer2 = Buffer.concat(chunks2);
            await sock.sendMessage(chatId, { audio: audioBuffer2, mimetype: 'audio/mpeg', fileName: `${safeTitle}.mp3` }, { quoted: msg });
            activeChats.delete(chatId);
            return;
          }

          console.error('ytdl-core fallback failed:', ff2err);
        } catch (yerr) {
          console.error('ytdl-core attempt error:', yerr);
        }
      }

      // Final fallback: try letting yt-dlp write an mp3 file directly (older method)
      const fallbackPath = path.join(TMP_DIR, `${Date.now()}.mp3`);
      const fallbackArgs = [
        '-x',
        '--audio-format', 'mp3',
        '--ffmpeg-location', ffmpegPath,
        '--quiet',
        '-o', fallbackPath,
        video.url
      ];

      const yt2 = spawn('yt-dlp', fallbackArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let yt2err = '';
      yt2.stderr?.on('data', (d) => { yt2err += d.toString(); });

      const closed = await new Promise((res) => yt2.on('close', res));
      if (closed !== 0 || !fs.existsSync(fallbackPath)) {
        activeChats.delete(chatId);
        return sock.sendMessage(chatId, { text: "❌ Download failed. Ensure 'yt-dlp' and 'ffmpeg' are installed on the server." }, { quoted: msg });
      }

      const buffer = fs.readFileSync(fallbackPath);
      await sock.sendMessage(chatId, { document: buffer, mimetype: 'audio/mpeg', fileName: `${safeTitle}.mp3` }, { quoted: msg });
      fs.unlinkSync(fallbackPath);
      activeChats.delete(chatId);
      return;
    }

    const audioBuffer = Buffer.concat(chunks);

    await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/mpeg', fileName: `${safeTitle}.mp3` }, { quoted: msg });

    activeChats.delete(chatId);

  } catch (err) {
    console.error('downloadCommand error:', err);
    activeChats.delete(chatId);
    await sock.sendMessage(chatId, { text: "❌ Download Failed. Please Try again" }, { quoted: msg });
  }
}
