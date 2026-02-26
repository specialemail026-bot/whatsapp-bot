import axios from "axios";
import yts from "yt-search";
import { checkLimitOrPremium } from "./premium.js";

export async function lyricsCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  
  console.log("📥 LYRICS command - Sender JID:", sender);

  if (!(await checkLimitOrPremium(sender, "lyrics"))) {
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

    // Use the correct API endpoint
    const apiUrl = `https://ef-prime-md-ultra-apis.vercel.app/search/lyrics?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(song)}`;
    
    console.log("🔗 Fetching lyrics from:", apiUrl);

    const response = await axios.get(apiUrl, { timeout: 10000 });

    if (!response.data?.answer) {
      return sock.sendMessage(chatId, {
        text: "❌ Lyrics not found. The song may be too new or rare."
      }, { quoted: msg });
    }

    const lyrics = response.data.answer;

    // Clean up the lyrics if it has the header "Paroles de la chanson..."
    let cleanedLyrics = lyrics;
    
    // Remove French header if present
    if (lyrics.includes("Paroles de la chanson")) {
      const lines = lyrics.split("\n");
      // Skip first line if it's the header
      cleanedLyrics = lines.slice(1).join("\n").trim();
    }

    // WhatsApp message length safety (max ~4096 chars, but we'll use 3400 to leave room for footer)
    const trimmedLyrics = cleanedLyrics.length > 3400
      ? cleanedLyrics.substring(0, 3400) + "\n\n…(truncated)"
      : cleanedLyrics;

    // Add footer
    const finalMessage = `📄 *Lyrics: ${song} - ${artist}*\n\n${trimmedLyrics}\n\n━━━━━━━━\nPowered by FRANKKAUMBADEV`;
    await sock.sendMessage(chatId, {
      text: finalMessage
    }, { quoted: msg });

  } catch (err) {
    console.error("LYRICS ERROR:", err.message);
    
    let errorMsg = "❌ Failed to fetch lyrics. Try another song.";
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      errorMsg = "❌ Request timeout. Please try again.";
    } else if (err.response?.status === 404) {
      errorMsg = "❌ Lyrics not found for this song.";
    }
    
    await sock.sendMessage(chatId, {
      text: errorMsg
    }, { quoted: msg });
  }
}
