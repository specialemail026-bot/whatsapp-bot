const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const PLAYLIST_IDS = [
  "37i9dQZEVXbMDoHDwVN2tF", // Global Top 50
  "37i9dQZF1DXcBWIGoYBM5M", // Today's Top Hits
  "37i9dQZEVXbLRQDuF5jeBp"  // US Top 50
];

let cachedToken = null;
let tokenExpiresAt = 0;

async function parseJsonSafe(res) {
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getSpotifyToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify credentials are missing (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).");
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

  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new Error(`Spotify token request failed: ${reason}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  return cachedToken;
}

async function fetchPlaylistTracks(token, playlistId) {
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10&market=US`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await parseJsonSafe(res);
  return { res, data, playlistId };
}

async function fetchSearchFallback(token) {
  // Fallback when playlist APIs are denied (403) for the app/account context.
  const url =
    "https://api.spotify.com/v1/search?q=top%20hits&type=track&limit=10&market=US";
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const reason = data?.error?.message || data?.error_description || `HTTP ${res.status}`;
    throw new Error(`Spotify search fallback failed: ${reason}`);
  }
  const items = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
  return items.map((track) => ({ track }));
}

export async function trendingCommand(sock, msg) {
  try {
    const token = await getSpotifyToken();

    let chosen = null;
    let lastError = null;
    for (const playlistId of PLAYLIST_IDS) {
      const attempt = await fetchPlaylistTracks(token, playlistId);
      if (attempt.res.ok && Array.isArray(attempt.data?.items) && attempt.data.items.length) {
        chosen = attempt;
        break;
      }
      const reason =
        attempt.data?.error?.message ||
        attempt.data?.error_description ||
        `HTTP ${attempt.res.status}`;
      lastError = `playlist ${playlistId}: ${reason}`;
    }

    let items = [];
    if (chosen) {
      items = Array.isArray(chosen.data?.items) ? chosen.data.items : [];
    } else {
      console.warn("All playlist attempts failed; using search fallback:", lastError);
      items = await fetchSearchFallback(token);
    }

    if (!items.length) {
      throw new Error("No trending tracks returned from Spotify.");
    }

    let text = "🔥 *Spotify Global Top 10*\n\n";

    items.forEach((item, index) => {
      const track = item.track;
      const artists = Array.isArray(track?.artists)
        ? track.artists.map((a) => a.name).join(", ")
        : "Unknown Artist";
      text += `${index + 1}. *${track.name}* — ${artists}\n`;
    });

    text += "\n🎧 _Powered by Spotify_";

    await sock.sendMessage(msg.key.remoteJid, { text });

  } catch (err) {
    console.error("TRENDING ERROR:", err);
    await sock.sendMessage(msg.key.remoteJid, {
      text: `❌ Failed to fetch Spotify trending tracks.\n${err?.message || ""}`.trim(),
    });
  }
}
