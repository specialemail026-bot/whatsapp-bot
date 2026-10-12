import fs from "fs";
import os from "os";
import path from "path";

export async function withYtDlpCookies(args, operation) {
  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
  const encodedCookies = process.env.YTDLP_COOKIES_BASE64?.trim();

  if (cookiesFile && encodedCookies) {
    throw new Error("Set only one of YTDLP_COOKIES_FILE or YTDLP_COOKIES_BASE64.");
  }

  if (cookiesFile) {
    const resolvedCookiesFile = path.resolve(cookiesFile);
    if (!fs.existsSync(resolvedCookiesFile) || !fs.statSync(resolvedCookiesFile).isFile()) {
      throw new Error("YTDLP_COOKIES_FILE must point to an existing cookie file.");
    }
    args.push("--cookies", resolvedCookiesFile);
    return operation();
  }

  if (!encodedCookies) return operation();

  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedCookies)) {
    throw new Error("YTDLP_COOKIES_BASE64 must contain valid Base64-encoded cookie data.");
  }

  const cookies = Buffer.from(encodedCookies, "base64");
  if (cookies.length === 0) {
    throw new Error("YTDLP_COOKIES_BASE64 decoded to an empty cookie file.");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dlp-cookies-"));
  const tempFile = path.join(tempDir, "cookies.txt");
  try {
    fs.writeFileSync(tempFile, cookies, { mode: 0o600 });
    args.push("--cookies", tempFile);
    return await operation();
  } finally {
    try {
      fs.unlinkSync(tempFile);
      fs.rmdirSync(tempDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
