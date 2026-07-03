import yts from 'yt-search';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
// Import from your package.json
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'; 
import { checkLimitOrPremium } from "./premium.js";

const TMP_DIR = "tmp";
const MIN_AUDIO_BYTES = 1024;

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR);
}

function safeFileName(title) {
  return (title || "song").replace(/[^\w\s.-]/g, "").substring(0, 80) || "song";
}

async function streamAudioToMp3(videoUrl) {
  const ytDlpProcess = spawn('yt-dlp', [
    videoUrl,
    '-f', 'bestaudio/best',
    '-o', '-',
    '--quiet',
    '--no-warnings',
    '--no-playlist'
  ]);

  const ffmpegProcess = spawn(ffmpegPath, [
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'mp3',
    'pipe:1'
  ]);

  let stderr = '';
  ytDlpProcess.stderr?.on('data', (d) => {
    stderr += d.toString();
  });
  ffmpegProcess.stderr?.on('data', (d) => {
    stderr += d.toString();
  });

  ytDlpProcess.stdout.pipe(ffmpegProcess.stdin);

  const chunks = [];
  for await (const chunk of ffmpegProcess.stdout) {
    chunks.push(chunk);
  }

  const [ytCode, ffCode] = await Promise.all([
    new Promise((resolve) => ytDlpProcess.on('close', resolve)),
    new Promise((resolve) => ffmpegProcess.on('close', resolve))
  ]);

  const audioBuffer = Buffer.concat(chunks);
  if (ytCode !== 0 || ffCode !== 0 || audioBuffer.length < MIN_AUDIO_BYTES) {
    throw new Error(`stream pipeline failed (yt-dlp=${ytCode}, ffmpeg=${ffCode}, bytes=${audioBuffer.length}): ${stderr}`);
  }

  return audioBuffer;
}

async function downloadAudioFile(videoUrl, outputPath) {
  await new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--ffmpeg-location', ffmpegPath,
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '-o', outputPath,
      videoUrl
    ]);

    let stderr = '';
    ytdlp.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    ytdlp.on('error', reject);
    ytdlp.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) return resolve();
      reject(new Error(`yt-dlp file fallback failed (${code}): ${stderr}`));
    });
  });
}

export default {
  name: "song",
  description: "Download audio using yt-dlp (Bypasses 403 and Decipher errors)",
  async execute(sock, msg, args) {
    const sender = msg.key.participant || msg.key.remoteJid;

    if (!(await checkLimitOrPremium(sender, "song_cmd"))) {
      return sock.sendMessage(msg.key.remoteJid, { text: "🚫 You've reached downloading limit.\n\n UPGRADE to Premium so you can download without limits for 1 month at K1,000 ONLY.\n\n📲 Withdrawal via Airtel code👉 *10249697* or TNM 089 006 1520 (Edison Chazumbwa).\n\n Contact admins at 0995551995, 0993702468, 0886219577 for help." }, { quoted: msg });
    }

    if (args.length === 0) return sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide a song name!" }, { quoted: msg });

    const query = args.join(" ");
    const from = msg.key.remoteJid;

    try {
      const search = await yts(query);
      const video = search.videos[0];
      if (!video) return sock.sendMessage(from, { text: "❌ Song not found." });

      await sock.sendMessage(from, {  text: `⏳ Downloading: *${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}` }, { quoted: msg });

      let audioBuffer;
      try {
        audioBuffer = await streamAudioToMp3(video.url);
      } catch (streamError) {
        console.error("SONG stream pipeline failed, trying file fallback:", streamError?.message || streamError);
        const fallbackPath = path.join(TMP_DIR, `${Date.now()}-${safeFileName(video.title)}.mp3`);
        try {
          await downloadAudioFile(video.url, fallbackPath);
          audioBuffer = fs.readFileSync(fallbackPath);
        } finally {
          if (fs.existsSync(fallbackPath)) fs.unlinkSync(fallbackPath);
        }

        if (audioBuffer.length < MIN_AUDIO_BYTES) {
          throw new Error(`file fallback produced an invalid audio file (${audioBuffer.length} bytes)`);
        }
      }

      await sock.sendMessage(from, {
        document: audioBuffer,
        mimetype: "audio/mpeg",
        fileName: `${safeFileName(video.title)}.mp3`,
        /*contextInfo: {
          externalAdReply: {
            title: video.title,
            body: `NexOra Engine`,
            //thumbnailUrl: video.thumbnail,
            mediaType: 2,
            mediaUrl: video.url,
            sourceUrl: video.url
          }
        }*/
      }, { quoted: msg });

    } catch (error) {
      console.error("Critical song Error:", error);
      await sock.sendMessage(from, { text: "❌Download failed. Try again." }, { quoted: msg });
    }
  },
};
