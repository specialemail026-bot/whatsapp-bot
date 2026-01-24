import fs from "fs";
import path from "path";
import axios from "axios";
import { isPremium } from "./premium.js";

const TMP_DIR = "tmp";
const MAX_SIZE = 100 * 1024 * 1024; // 100MB WhatsApp limit

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function isGoogleDrive(url) {
  return /drive\.google\.com/.test(url);
}

function extractDriveId(url) {
  const match = url.match(/\/d\/([^/]+)/) || url.match(/id=([^&]+)/);
  return match ? match[1] : null;
}

function detectFileType(filename, contentType = "") {
  const name = (filename || "").toLowerCase();

  if (name.endsWith(".pdf") || contentType.includes("pdf"))
    return { mime: "application/pdf", emoji: "📕" };

  if (name.endsWith(".doc") || name.endsWith(".docx") || contentType.includes("word"))
    return { mime: "application/msword", emoji: "📄" };

  if (name.endsWith(".ppt") || name.endsWith(".pptx") || contentType.includes("powerpoint"))
    return { mime: "application/vnd.ms-powerpoint", emoji: "📊" };

  if (name.endsWith(".xls") || name.endsWith(".xlsx") || contentType.includes("excel"))
    return { mime: "application/vnd.ms-excel", emoji: "📈" };

  if (name.endsWith(".zip") || name.endsWith(".rar") || contentType.includes("zip") || contentType.includes("compressed"))
    return { mime: "application/zip", emoji: "🗜️" };

  return { mime: contentType || "application/octet-stream", emoji: "📁" };
}

export async function docCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;

  // 🔒 Premium check
  if (!isPremium(sender)) {
    return sock.sendMessage(
      chatId,
      {
        text:
          "🚫 This feature is for *Premium users only*.\n\n" +
          "Pay K1,000 once and download PDFs, books & Google Drive notes forever.\n\n" +
          "📞 Contact admin @0995551995 to upgrade."
      },
      { quoted: msg }
    );
  }

  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  const url = text.split(" ").slice(1).join(" ").trim();

  if (!url || !/^https?:\/\//i.test(url)) {
    return sock.sendMessage(chatId, { text: "📄 Usage:\n.doc <document link>" }, { quoted: msg });
  }

  try {
    let downloadUrl = url;
    let filename = `document_${Date.now()}`;

    // 🔹 Google Drive handling
    if (isGoogleDrive(url)) {
      const fileId = extractDriveId(url);
      if (!fileId) {
        return sock.sendMessage(chatId, { text: "❌ Invalid Google Drive link." }, { quoted: msg });
      }
      downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    } else {
      filename = path.basename(url.split("?")[0]) || filename;
    }

    await sock.sendMessage(chatId, { text: "📥 Downloading document… please wait." }, { quoted: msg });

    const response = await axios({
      method: "GET",
      url: downloadUrl,
      responseType: "stream",
      timeout: 0
    });

    const contentType = response.headers["content-type"] || "";

    // attempt to get filename from headers
    const disposition = response.headers["content-disposition"] || "";
    const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
    if (nameMatch && nameMatch[1]) {
      filename = decodeURIComponent(nameMatch[1]);
    }

    // ensure filename has an extension when possible
    if (!path.extname(filename) && contentType) {
      if (contentType.includes("pdf")) filename += ".pdf";
      else if (contentType.includes("msword") || contentType.includes("word")) filename += ".docx";
      else if (contentType.includes("powerpoint")) filename += ".pptx";
      else if (contentType.includes("excel")) filename += ".xlsx";
    }

    const filePath = path.join(TMP_DIR, filename);

    let size = 0;
    const writer = fs.createWriteStream(filePath);

    response.data.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        // stop download
        response.data.destroy(new Error("MAX_SIZE_EXCEEDED"));
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
      response.data.on("error", reject);
    });

    if (size > MAX_SIZE) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return sock.sendMessage(chatId, { text: "⚠️ File too large for WhatsApp." }, { quoted: msg });
    }

    const { mime, emoji } = detectFileType(filename, contentType);

    await sock.sendMessage(
      chatId,
      {
        document: fs.readFileSync(filePath),
        fileName: filename,
        mimetype: mime,
        caption: `${emoji} Document downloaded successfully`
      },
      { quoted: msg }
    );

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error("DOC COMMAND ERROR:", err && err.message ? err.message : err);
    // cleanup if any partial file
    try {
      const parts = (err && err.path) ? [err.path] : [];
      // best-effort cleanup of tmp dir if filename known
    } catch (e) {
      /* ignore */
    }
    await sock.sendMessage(chatId, { text: "❌ Failed to download document." }, { quoted: msg });
  }
}
