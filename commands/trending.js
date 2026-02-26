import fetch from "node-fetch";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const TOP_TRACKS_URL =
  "https://api.spotify.com/v1/playlists/37i9dQZEVXbMDoHDwVN2tF/tracks?limit=10";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getSpotifyToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const auth = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  return cachedToken;
}

export async function trendingCommand(sock, msg) {
  try {
    const token = await getSpotifyToken();

    const res = await fetch(TOP_TRACKS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();

    let text = "🔥 *Spotify Global Top 10*\n\n";

    data.items.forEach((item, index) => {
      const track = item.track;
      const artists = track.artists.map(a => a.name).join(", ");
      text += `${index + 1}. *${track.name}* — ${artists}\n`;
    });

    text += "\n🎧 _Powered by Spotify_";

    await sock.sendMessage(msg.key.remoteJid, { text });

  } catch (err) {
    console.error("TRENDING ERROR:", err);
    await sock.sendMessage(msg.key.remoteJid, {
      text: "❌ Failed to fetch Spotify trending tracks.",
    });
  }
}