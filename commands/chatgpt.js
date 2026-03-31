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

// Send response with real-time word-by-word typing animation
async function sendStreamingResponse(sock, chatId, msg, fullText) {
  const header = `🤖 *ChatGPT Response*`;
  
  const words = fullText.split(" ");
  let currentMessage = "";
  let sentMessage = null;
  
  // Stream words with animation
  for (let i = 0; i < words.length; i++) {
    currentMessage += (i === 0 ? "" : " ") + words[i];
    
    // Send/update message every 3 words to reduce message spam
    if (i % 3 === 2 || i === words.length - 1) {
      const displayText = header + currentMessage + (i < words.length - 1 ? " ▌" : "");
      
      if (!sentMessage) {
        // Send first message
        sentMessage = await sock.sendMessage(
          chatId,
          { text: displayText },
          { quoted: msg }
        );
      } else {
        // Update existing message (note: WhatsApp doesn't support real editing, so we send new ones sparingly)
        await sock.sendMessage(
          chatId,
          { text: displayText },
          { quoted: msg }
        );
      }
    }
    
    // Small delay between word additions for typing effect
    await new Promise(resolve => setTimeout(resolve, 80));
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
    
    // Send with streaming/typing effect
    await sendStreamingResponse(sock, chatId, msg, formattedAnswer);

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