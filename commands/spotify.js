import axios from 'axios';
import fs from "fs";
import path from "path";
import { checkLimitOrPremium } from "./premium.js";

const TMP_DIR = "tmp";

// ensure tmp exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR);
}

export async function spotifyCommand(sock, chatId, message) {
    const sender = message.key.participant || message.key.remoteJid;
    
    console.log("📥 SPOTIFY command - Sender JID:", sender);

    if (!checkLimitOrPremium(sender, chatId, "song")) {
        return sock.sendMessage(chatId, {
            text: "🚫 You've reached today's limit.\n\n Pay K600 once and download forever without limits.\n\n📲 099 555 1995 or 088 996 4091 (Edison Chazumbwa)."
        }, { quoted: message });
    }

    try {
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            '';

        const used = (rawText || '').split(/\s+/)[0] || '.spotify';
        const query = rawText.slice(used.length).trim();

        if (!query) {
            return sock.sendMessage(chatId, { text: 'Usage: .spotify <Spotify track URL>\nExample: .spotify https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' }, { quoted: message });
        }

        // Check if it's a valid Spotify track URL
        const spotifyRegex = /https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+/;
        if (!spotifyRegex.test(query)) {
            return sock.sendMessage(chatId, { text: 'Please provide a valid Spotify track URL.\nExample: .spotify https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text: `🎵 Downloading from Spotify...`
        }, { quoted: message });

        // Use Spotify downloader API
        const apiUrl = `https://api.spotifydown.com/download?url=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl, { timeout: 20000, headers: { 'user-agent': 'Mozilla/5.0' } });

        if (!data || !data.audioUrl) {
            throw new Error('No download link from Spotify API');
        }

        const audioUrl = data.audioUrl;
        const title = data.title || 'Spotify Track';
        const artist = data.artist || '';
        const safeTitle = title.replace(/[^\w\s.-]/g, "");

        // Download the audio
        const response = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60000 });
        const buffer = Buffer.from(response.data);

        await sock.sendMessage(chatId, {
            document: buffer,
            mimetype: "audio/mpeg",
            fileName: `${safeTitle}.mp3`,
            caption: `🎵 ${title}\n👤 ${artist}`
        }, { quoted: message });

    } catch (error) {
        console.error('[SPOTIFY] error:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'Failed to download from Spotify. Make sure the URL is valid and public.' }, { quoted: message });
    }
}
