import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TelegramClient } from "./telegram.js";
import { PostDrafter } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = join(__dirname, "..", "skill", "meera-voice.md");

const START_TEXT =
  "Send me a note — what you want the post to be about, plus any real numbers, mechanisms, or honest limitations you want in it. I'll draft it in your voice and send it back here for you to review before you post it to LinkedIn.";

export function createBot(env = process.env) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, GEMINI_MODEL } = env;

  if (!TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_CHAT_ID is not set — refusing to run without a chat allowlist");
  }

  const telegram = new TelegramClient(TELEGRAM_BOT_TOKEN);
  const drafter = new PostDrafter(GEMINI_API_KEY, GEMINI_MODEL, readFileSync(SKILL_FILE, "utf8"));

  async function handleUpdate(update) {
    const message = update.message ?? update.channel_post;
    if (!message) return;

    const chatId = message.chat.id;
    if (String(chatId) !== String(TELEGRAM_CHAT_ID)) {
      console.log(`Ignoring message from unrecognised chat ${chatId}`);
      return;
    }

    const text = message.text?.trim();
    if (!text) return;

    if (text === "/start") {
      await telegram.sendMessage(chatId, START_TEXT);
      return;
    }

    console.log(`Drafting post for note: ${text.slice(0, 80)}...`);
    await telegram.sendChatAction(chatId, "typing");

    try {
      const draft = await withTimeout(drafter.draft(text), 45000, "Gemini took too long to respond");
      await telegram.sendMessage(chatId, draft);
      console.log("Reply sent successfully.");
    } catch (err) {
      console.error("Draft generation failed:", err);
      await telegram.sendMessage(chatId, `Sorry, something went wrong drafting that: ${err.message}`);
    }
  }

  return { telegram, handleUpdate };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
