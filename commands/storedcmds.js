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



import axios from "axios";
import yts from "yt-search";
import { checkLimitOrPremium } from "./premium.js";

export async function lyricsCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 LYRICS command - Sender JID:", sender);

  if (!checkLimitOrPremium(sender, "song")) {
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
        text: "📄 Type this: .lyrics song name"
      }, { quoted: msg });
    }

    // Search song (to get artist + title cleanly)
    const search = await yts(query);
    if (!search.videos.length) {
      return sock.sendMessage(chatId, {
        text: "❌ Song not found."
      }, { quoted: msg });
    }

    const video = search.videos[0];
    const title = video.title;

    // Try to split artist - title
    let artist = "";
    let song = title;

    if (title.includes("-")) {
      [artist, song] = title.split("-").map(t => t.trim());
    } else {
      song = title;
      artist = search.videos[0].author?.name || "";
    }

    await sock.sendMessage(chatId, {
      text: `📄 Fetching lyrics for:\n*${song}* — ${artist}`
    }, { quoted: msg });

    // Try multiple lyrics APIs for better reliability
    let lyrics = null;
    
    // Try lyrics.ovh first
    try {
      const res = await axios.get(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`,
        { timeout: 5000 }
      );
      lyrics = res.data?.lyrics;
    } catch (e) {
      console.log("lyrics.ovh failed, trying alternative...");
    }

    // Fallback to genius (simple scrape)
    if (!lyrics) {
      try {
        const geniusRes = await axios.get(
          `https://api.genius.com/search?q=${encodeURIComponent(song)} ${encodeURIComponent(artist)}`,
          { timeout: 5000 }
        );
        if (geniusRes.data?.response?.hits?.[0]) {
          const hit = geniusRes.data.response.hits[0];
          lyrics = `🎵 ${hit.result.title} by ${hit.result.primary_artist.name}\n\n📖 Full lyrics available at: ${hit.result.url}`;
        }
      } catch (e) {
        console.log("Genius fallback failed");
      }
    }

    if (!lyrics) {
      return sock.sendMessage(chatId, {
        text: "❌ Lyrics not found. The song may be too new or rare."
      }, { quoted: msg });
    }

    // WhatsApp message length safety
    const trimmedLyrics = lyrics.length > 3500
      ? lyrics.substring(0, 3500) + "\n\n…(truncated)"
      : lyrics;

    await sock.sendMessage(chatId, {
      text: `📄 *Lyrics for: ${song} - ${artist}*\n\n${trimmedLyrics}`
    }, { quoted: msg });

  } catch (err) {
    console.error("LYRICS ERROR:", err.message);
    await sock.sendMessage(chatId, {
      text: "❌ Failed to fetch lyrics. Try another song."
    }, { quoted: msg });
  }
}




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
  
  console.log("📥 Play command - Sender JID:", sender);

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

    const downloadUrl = `https://ef-prime-md-ultra-apis.vercel.app/downloader/ytdlv2?url=${encodeURIComponent(video.url)}&format=audio`;
    const downloadResponse = await axios.get(downloadUrl);

    if (!downloadResponse.data.answer.status) {
      activeChats.delete(chatId);
      return sock.sendMessage(
        chatId,
        { text: "❌ Download failed. Try again." },
        { quoted: msg }
      );
    }

    const audioUrl = downloadResponse.data.answer.audio_url;
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
      { text: "❌ Try again please." },
      { quoted: msg }
    );
  }
}

export const playCommand = { execute };



import axios from 'axios';
import fs from "fs";
import path from "path";
import { checkLimitOrPremium } from "./premium.js";

const TMP_DIR = "tmp";
const activeChats = new Set();

// Spotify API credentials (set via environment or hardcode for testing)
// Get your own at https://developer.spotify.com/dashboard
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '52b70cda-e8b1-4a48-b289-98804c08e9a7';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'd18e6e0e84e4492fa10e04fe6c9b8d2d';

let spotifyAccessToken = null;
let spotifyTokenExpiry = 0;

// ensure tmp exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR);
}

// Authenticate with Spotify API using direct HTTP
async function getSpotifyAccessToken() {
  if (spotifyAccessToken && Date.now() < spotifyTokenExpiry) {
    return spotifyAccessToken;
  }

  try {
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 5000
    });

    spotifyAccessToken = response.data.access_token;
    spotifyTokenExpiry = Date.now() + (response.data.expires_in * 1000);
    console.log("✅ Spotify API authenticated");
    return spotifyAccessToken;
  } catch (err) {
    console.error("❌ Spotify API auth failed:", err.message);
    return null;
  }
}

export async function spotifyCommand(sock, chatId, message) {
    const sender = message.key.participant || message.key.remoteJid;
    
    console.log("📥 SPOTIFY command - Sender JID:", sender);

    if (activeChats.has(chatId)) {
      return sock.sendMessage(
        chatId,
        { text: "⏳ Please wait, another song is being downloaded…" },
        { quoted: message }
      );
    }

    if (!checkLimitOrPremium(sender, "song")) {
        return sock.sendMessage(chatId, {
            text: "🚫 You've reached limit.\n\n Pay K1,000 once and download forever without limits.\n\n📲 099 555 1995 or 088 996 4091 (Edison Chazumbwa)."
        }, { quoted: message });
    }

    activeChats.add(chatId);

    try {
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            '';

        const used = (rawText || '').split(/\s+/)[0] || '.spotify';
        const query = rawText.slice(used.length).trim();

        if (!query) {
            activeChats.delete(chatId);
            return sock.sendMessage(chatId, { 
              text: 'Usage: .spotify song name\nExample: .spotify Despacito' 
            }, { quoted: message });
        }

        // If it's a Spotify URL, download directly
        const spotifyRegex = /https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+/;
        if (spotifyRegex.test(query)) {
          return handleSpotifyURL(sock, chatId, message, query, activeChats);
        }

        // Search Spotify by song name
        return handleSpotifySearch(sock, chatId, message, query, activeChats);

    } catch (error) {
        activeChats.delete(chatId);
        console.error('[SPOTIFY] error:', error?.message || error);
        await sock.sendMessage(chatId, { 
          text: 'Failed to download song. Try another search.' 
        }, { quoted: message });
    }
}

async function handleSpotifyURL(sock, chatId, message, spotifyUrl, activeChats) {
  try {
    await sock.sendMessage(chatId, {
        text: `🎵 Downloading from Spotify...`
    }, { quoted: message });

    // Use Spotify downloader API
    const apiUrl = `https://api.spotifydown.com/download?url=${encodeURIComponent(spotifyUrl)}`;
    const { data } = await axios.get(apiUrl, { timeout: 20000, headers: { 'user-agent': 'Mozilla/5.0' } });

    if (!data || !data.audioUrl) {
        throw new Error('No download link from Spotify API');
    }

    const audioUrl = data.audioUrl;
    const title = data.title || 'Spotify Track';
    const artist = data.artist || '';

    // Download the audio
    const response = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60000 });
    const buffer = Buffer.from(response.data);

    await sock.sendMessage(chatId, {
        audio: buffer,
        mimetype: "audio/mpeg",
        ptt: false
    }, { quoted: message });

    activeChats.delete(chatId);

  } catch (error) {
    activeChats.delete(chatId);
    console.error('[SPOTIFY URL] error:', error?.message || error);
    await sock.sendMessage(chatId, { 
      text: 'Failed to download from Spotify. Make sure the URL is valid and public.' 
    }, { quoted: message });
  }
}

async function handleSpotifySearch(sock, chatId, message, query, activeChats) {
  try {
    await sock.sendMessage(chatId, {
      text: `🔍 Searching Spotify for: *${query}*`
    }, { quoted: message });

    // Get access token
    const token = await getSpotifyAccessToken();
    if (!token) {
      activeChats.delete(chatId);
      return sock.sendMessage(chatId, {
        text: "❌ Cannot connect to Spotify API. Try again later."
      }, { quoted: message });
    }

    // Search Spotify by song/artist name using HTTP request
    const searchResponse = await axios.get('https://api.spotify.com/v1/search', {
      params: {
        q: query,
        type: 'track',
        limit: 1
      },
      headers: {
        'Authorization': `Bearer ${token}`
      },
      timeout: 10000
    });

    if (!searchResponse.data.tracks.items.length) {
      activeChats.delete(chatId);
      return sock.sendMessage(chatId, {
        text: "❌ Song not found on Spotify."
      }, { quoted: message });
    }

    const track = searchResponse.data.tracks.items[0];
    const spotifyUrl = track.external_urls.spotify;
    const title = track.name;
    const artist = track.artists.map(a => a.name).join(", ");

    await sock.sendMessage(chatId, {
      text: `🎵 Downloading: *${title}*\n👤 ${artist}\n⏱️ Duration: ${Math.floor(track.duration_ms / 1000)} seconds`
    }, { quoted: message });

    // Use Spotify downloader API to get audio
    const apiUrl = `https://api.spotifydown.com/download?url=${encodeURIComponent(spotifyUrl)}`;
    const { data: downloadData } = await axios.get(apiUrl, { 
      timeout: 20000, 
      headers: { 'user-agent': 'Mozilla/5.0' } 
    });

    if (!downloadData || !downloadData.audioUrl) {
      activeChats.delete(chatId);
      throw new Error('No download link available');
    }

    // Download the audio
    const response = await axios.get(downloadData.audioUrl, { 
      responseType: 'arraybuffer', 
      timeout: 60000 
    });
    const buffer = Buffer.from(response.data);

    // Validate file size
    if (buffer.length > 95 * 1024 * 1024) {
      activeChats.delete(chatId);
      return sock.sendMessage(chatId, {
        text: "⚠️ Audio file too large for WhatsApp."
      }, { quoted: message });
    }

    await sock.sendMessage(chatId, {
      audio: buffer,
      mimetype: "audio/mpeg",
      ptt: false
    }, { quoted: message });

    activeChats.delete(chatId);

  } catch (error) {
    activeChats.delete(chatId);
    console.error('[SPOTIFY SEARCH] error:', error?.message || error);
    await sock.sendMessage(chatId, { 
      text: 'Failed to download from Spotify. Try another song.' 
    }, { quoted: message });
  }
}
