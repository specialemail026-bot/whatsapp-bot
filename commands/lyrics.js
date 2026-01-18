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
