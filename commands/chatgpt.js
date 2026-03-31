import axios from "axios";
import { checkLimitOrPremium } from "./premium.js";

const AI_BASE = "https://ef-prime-md-ultra-apis.vercel.app";
const AI_MODEL = "gpt-5";
const CHATGPT_HEADER = "[ChatGPT Response]";
const TYPING_UPDATE_INTERVAL_MS = 350;
const MAX_WORDS_PER_UPDATE = 3;
const MAX_CHARS_PER_MESSAGE = 3800;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Format response with better styling for WhatsApp
function formatAIResponse(answer) {
  let formatted = answer.trim();

  // Add better spacing between paragraphs
  formatted = formatted.replace(/\n\n+/g, "\n\n");

  // Convert markdown-style headers (# Header) to bold
  formatted = formatted.replace(/^#+\s+(.+)$/gm, "*$1*");

  // Convert markdown bold (**text**) to WhatsApp bold (*text*)
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Add line breaks for better readability (limit line length)
  const lines = formatted.split("\n");
  const formattedLines = lines.map((line) => {
    if (line.length > 80) {
      // Break long lines for better readability
      const words = line.split(" ");
      let currentLine = "";
      const result = [];

      words.forEach((word) => {
        if ((currentLine + word).length > 80) {
          if (currentLine) result.push(currentLine);
          currentLine = word;
        } else {
          currentLine = currentLine ? `${currentLine} ${word}` : word;
        }
      });

      if (currentLine) result.push(currentLine);
      return result.join("\n");
    }

    return line;
  });

  return formattedLines.join("\n");
}

function buildTypingFrames(fullAnswer) {
  const words = fullAnswer.split(/\s+/).filter(Boolean);

  if (!words.length) {
    return [`${CHATGPT_HEADER}\n\n`];
  }

  const frames = [];
  let currentWords = [];

  for (let i = 0; i < words.length; i += MAX_WORDS_PER_UPDATE) {
    currentWords.push(...words.slice(i, i + MAX_WORDS_PER_UPDATE));
    frames.push(`${CHATGPT_HEADER}\n\n${currentWords.join(" ")}`);
  }

  const finalFrame = `${CHATGPT_HEADER}\n\n${fullAnswer}`;
  if (frames[frames.length - 1] !== finalFrame) {
    frames.push(finalFrame);
  }

  return frames;
}

function splitIntoMessageParts(text, maxLength = MAX_CHARS_PER_MESSAGE) {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

// Simulate typing animation by editing the same message as the answer grows.
async function streamResponse(sock, chatId, msg, fullAnswer) {
  const messageParts = splitIntoMessageParts(fullAnswer);

  for (let partIndex = 0; partIndex < messageParts.length; partIndex++) {
    const part = messageParts[partIndex];
    const frames = buildTypingFrames(part);

    let sentMessage = await sock.sendMessage(
      chatId,
      { text: frames[0] },
      { quoted: partIndex === 0 ? msg : undefined }
    );

    for (let i = 1; i < frames.length; i++) {
      try {
        await sock.sendPresenceUpdate("composing", chatId);
        await delay(TYPING_UPDATE_INTERVAL_MS);
        sentMessage = await sock.sendMessage(chatId, {
          text: frames[i],
          edit: sentMessage.key,
        });
      } catch (err) {
        console.error("Stream update error:", err.message);
        break;
      }
    }

    await sock.sendPresenceUpdate("paused", chatId);
  }
}

export async function chatgptCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;

  console.log("CHATGPT command - Sender JID:", sender);

  if (!checkLimitOrPremium(sender, "Chatgpt")) {
    return sock.sendMessage(
      chatId,
      {
        text: "You've reached downloading limit.\n\nUPGRADE to Premium so you can download without limits for 1 month at K1,000 ONLY.\n\nWithdrawal via Airtel code *10249697* or TNM 089 006 1520 (Edison Chazumbwa).\n\nContact admins at 0995551995, 0993702468, 0886219577 for help.",
      },
      { quoted: msg }
    );
  }

  try {
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";
    const message = text.split(" ").slice(1).join(" ").trim();

    if (!message) {
      return sock.sendMessage(
        chatId,
        { text: "Type this: .chatgpt your question here" },
        { quoted: msg }
      );
    }

    const thinkingMessage = await sock.sendMessage(
      chatId,
      { text: "Generating response..." },
      { quoted: msg }
    );

    const url = `${AI_BASE}/ai/copilot?message=${encodeURIComponent(message)}&model=${AI_MODEL}`;

    console.log("Sending to ChatGPT:", url);

    const response = await axios.get(url, { timeout: 30000 });

    const answer = response.data?.answer;

    if (!answer) {
      return sock.sendMessage(
        chatId,
        { text: "No response from AI. Please try again." },
        { quoted: msg }
      );
    }

    const formattedAnswer = formatAIResponse(answer);

    try {
      await sock.sendMessage(chatId, { delete: thinkingMessage.key });
    } catch (deleteErr) {
      console.error("Thinking message delete error:", deleteErr.message);
    }

    await streamResponse(sock, chatId, msg, formattedAnswer);
  } catch (err) {
    console.error("CHATGPT ERROR:", err.message);

    let errorMsg = "Failed to get a response. Try again.";
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      errorMsg = "Request timeout. Please try again.";
    } else if (err.response?.status === 429) {
      errorMsg = "Too many requests. Please wait a moment and try again.";
    }

    await sock.sendMessage(chatId, { text: errorMsg }, { quoted: msg });
  }
}
