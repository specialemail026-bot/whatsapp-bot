import axios from "axios";
import { checkLimitOrPremium } from "./premium.js";

const AI_BASE = "https://ef-prime-md-ultra-apis.vercel.app";
const AI_MODEL = "gpt-5";
const CHATGPT_HEADER = "🤖ChatGPT response";
const CURSOR = "|";
const TYPING_UPDATE_INTERVAL_MS = 40;
const CHARS_PER_TICK = 18;
const MAX_MESSAGE_LENGTH = 3800;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatAIResponse(answer) {
  let formatted = answer.trim().replace(/\r\n/g, "\n");

  // Normalize spacing without disturbing code blocks.
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  // Convert markdown headings to WhatsApp bold.
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert markdown bold to WhatsApp bold.
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Normalize bullet markers for cleaner list rendering.
  formatted = formatted.replace(/^[\-\*]\s+/gm, "- ");

  // Preserve fenced code blocks and trim extra empty lines inside them.
  formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, language = "", code = "") => {
    const cleanCode = code.replace(/\n{3,}/g, "\n\n").trimEnd();
    return language
      ? `\`\`\`${language}\n${cleanCode}\n\`\`\``
      : `\`\`\`\n${cleanCode}\n\`\`\``;
  });

  // If the model returned unfenced code, wrap obvious code-like blocks.
  formatted = formatted.replace(
    /(?:^|\n)((?:(?:const|let|var|function|class|if|for|while|return|import|export|async|await|<\w+|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER).*(?:\n|$)){2,})/gm,
    (_, codeBlock) => `\n\`\`\`\n${codeBlock.trim()}\n\`\`\``
  );

  return formatted.trim();
}

function splitMessageParts(text, maxLength = MAX_MESSAGE_LENGTH) {
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

function buildStreamingFrames(text) {
  if (!text) {
    return [""];
  }

  const frames = [];
  let current = "";

  for (let i = 0; i < text.length; i += CHARS_PER_TICK) {
    current += text.slice(i, i + CHARS_PER_TICK);
    frames.push(current);
  }

  if (frames[frames.length - 1] !== text) {
    frames.push(text);
  }

  return frames;
}

function buildDisplayText(body, showCursor) {
  const cursor = showCursor ? CURSOR : "";
  return `${CHATGPT_HEADER}\n\n${body}${cursor}`;
}

async function streamResponse(sock, chatId, msg, fullAnswer, initialMessage) {
  const parts = splitMessageParts(fullAnswer);

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const frames = buildStreamingFrames(part);
    let sentMessage;

    if (partIndex === 0 && initialMessage?.key) {
      sentMessage = initialMessage;
      await sock.sendMessage(chatId, {
        text: buildDisplayText(frames[0], true),
        edit: sentMessage.key,
      });
    } else {
      sentMessage = await sock.sendMessage(
        chatId,
        { text: buildDisplayText(frames[0], true) },
        { quoted: partIndex === 0 ? msg : undefined }
      );
    }

    for (let i = 1; i < frames.length; i++) {
      try {
        await delay(TYPING_UPDATE_INTERVAL_MS);
        sentMessage = await sock.sendMessage(chatId, {
          text: buildDisplayText(frames[i], true),
          edit: sentMessage.key,
        });
      } catch (err) {
        console.error("Stream update error:", err.message);
        break;
      }
    }

    try {
      await sock.sendMessage(chatId, {
        text: buildDisplayText(part, false),
        edit: sentMessage.key,
      });
    } catch (err) {
      console.error("Final stream update error:", err.message);
    }
  }
}

export async function chatgptCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;

  console.log("CHATGPT command - Sender JID:", sender);

  if (!checkLimitOrPremium(sender, "Chatgpt")) {
    return sock.sendMessage(
      chatId,
      {
        text: "You have reached your limit for ChatGPT. Please consider *upgrading to premium for unlimited access.*\n\nContact admins to upgrade",
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
        { text: "Type this: .chatgpt (your question here)" },
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

    await streamResponse(sock, chatId, msg, formattedAnswer, thinkingMessage);
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
