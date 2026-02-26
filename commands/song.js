import yts from 'yt-search';
import { spawn } from 'child_process';
// Import from your package.json
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'; 
import { checkLimitOrPremium } from "./premium.js";

export default {
  name: "song",
  description: "Download audio using yt-dlp (Bypasses 403 and Decipher errors)",
  async execute(sock, msg, args) {
    const sender = msg.key.participant || msg.key.remoteJid;

    if (!(await checkLimitOrPremium(sender, "song_cmd"))) {
      return sock.sendMessage(msg.key.remoteJid, { text: "🚫 You've reached limit.\n\n Pay K1,000 once and download without limits.\n\n📲 099 555 1995 or 088 996 4091 (Edison Chazumbwa)." }, { quoted: msg });
    }

    if (args.length === 0) return sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide a song name!" }, { quoted: msg });

    const query = args.join(" ");
    const from = msg.key.remoteJid;

    try {
      const search = await yts(query);
      const video = search.videos[0];
      if (!video) return sock.sendMessage(from, { text: "❌ Song not found." });

      await sock.sendMessage(from, {  text: `⏳ Downloading: *${video.title}*\n⏱️ Duration: ${video.duration?.timestamp || 'Unknown'}\n👀 Views: ${video.views?.toLocaleString() || 'Unknown'}` }, { quoted: msg });

      // 1. Spawn yt-dlp (Must be installed on your system/VPS)
      const ytDlpProcess = spawn('yt-dlp', [
        video.url,
        '-f', 'bestaudio',
        '-o', '-', 
        '--quiet',
        '--no-playlist'
      ]);

      // 2. Spawn FFmpeg using the path from your installer
      const ffmpegProcess = spawn(ffmpegPath, [
        '-i', 'pipe:0',
        '-vn',
        '-ab', '128k',
        '-ar', '44100',
        '-f', 'mp3',
        'pipe:1'
      ]);

      // Pipe yt-dlp output into FFmpeg input
      ytDlpProcess.stdout.pipe(ffmpegProcess.stdin);

      const chunks = [];
      for await (const chunk of ffmpegProcess.stdout) {
        chunks.push(chunk);
      }
      
      const audioBuffer = Buffer.concat(chunks);

      await sock.sendMessage(from, {
        document: audioBuffer,
        mimetype: "audio/mpeg",
        fileName: `${video.title}.mp3`,
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
