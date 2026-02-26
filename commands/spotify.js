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

    if (!(await checkLimitOrPremium(sender, "song"))) {
        return sock.sendMessage(chatId, {
            text: "🚫 You've reached limit.\n\n Pay K1,000 once and download without limits.\n\n📲 099 555 1995 or 088 996 4091 (Edison Chazumbwa)."
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
