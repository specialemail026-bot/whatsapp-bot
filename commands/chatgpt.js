import axios from "axios";
import { checkLimitOrPremium } from "./premium.js";

const AI_BASE = "https://ef-prime-md-ultra-apis.vercel.app";
const AI_MODEL = "gpt-5";

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
  const formattedLines = lines.map(line => {
    if (line.length > 80) {
      // Break long lines for better readability
      const words = line.split(" ");
      let currentLine = "";
      const result = [];
      
      words.forEach(word => {
        if ((currentLine + word).length > 80) {
          if (currentLine) result.push(currentLine);
          currentLine = word;
        } else {
          currentLine = currentLine ? currentLine + " " + word : word;
        }
      });
      if (currentLine) result.push(currentLine);
      return result.join("\n");
    }
    return line;
  });
  
  return formattedLines.join("\n");
}

// Simulate typing animation by building message word by word
async function streamResponse(sock, chatId, msg, fullAnswer) {
  const words = fullAnswer.split(" ");
  let currentMessage = `🤖 *ChatGPT Response*\n\n`;
  let lastSendTime = Date.now();
  let sentMessageKey = null;

  for (let i = 0; i < words.length; i++) {
    currentMessage += words[i] + " ";
    
    // Send/update every 250ms for smooth animation
    if (Date.now() - lastSendTime > 250 || i === words.length - 1) {
      try {
        if (!sentMessageKey) {
          // First send
          const result = await sock.sendMessage(
            chatId,
            { text: currentMessage.trim() },
            { quoted: msg }
          );
          sentMessageKey = result.key;
        } else {
          // Edit existing message
          await sock.editMessage(
            chatId,
            sentMessageKey,
            { text: currentMessage.trim() }
          );
        }
        lastSendTime = Date.now();
      } catch (err) {
        // If edit fails, just continue with the text we have
        console.error("Stream update error:", err.message);
      }
    }
  }
}

export async function chatgptCommand(sock, chatId, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;

  console.log("📥 CHATGPT command - Sender JID:", sender);

  if (!checkLimitOrPremium(sender, "Chatgpt")) {
    return sock.sendMessage(
      chatId,
      {
        text: "🚫 You've reached downloading limit.\n\n UPGRADE to Premium so you can download without limits for 1 month at K1,000 ONLY.\n\n📲 Withdrawal via Airtel code👉 *10249697* or TNM 089 006 1520 (Edison Chazumbwa).\n\n Contact admins at 0995551995, 0993702468, 0886219577 for help.",
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
        { text: "🤖 Type this: .chatgpt your question here" },
        { quoted: msg }
      );
    }

    // Send thinking indicator
    await sock.sendMessage(
      chatId,
      { text: "⏳ Generating response..." },
      { quoted: msg }
    );

    const url = `${AI_BASE}/ai/copilot?message=${encodeURIComponent(message)}&model=${AI_MODEL}`;

    console.log("🤖 Sending to ChatGPT:", url);

    const response = await axios.get(url, { timeout: 30000 });

    const answer = response.data?.answer;

    if (!answer) {
      return sock.sendMessage(
        chatId,
        { text: "❌ No response from AI. Please try again." },
        { quoted: msg }
      );
    }

    const formattedAnswer = formatAIResponse(answer);
    
    // Send with streaming animation
    await streamResponse(sock, chatId, msg, formattedAnswer);

  } catch (err) {
    console.error("CHATGPT ERROR:", err.message);

    let errorMsg = "❌ Failed to get a response. Try again.";
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      errorMsg = "❌ Request timeout. Please try again.";
    } else if (err.response?.status === 429) {
      errorMsg = "❌ Too many requests. Please wait a moment and try again.";
    }

    await sock.sendMessage(chatId, { text: errorMsg }, { quoted: msg });
  }
}