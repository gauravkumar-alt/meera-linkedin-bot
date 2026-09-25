import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TelegramClient } from "./telegram.js";
import { PostDrafter, NoteScorer } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = join(__dirname, "..", "skill", "meera-voice.md");
const RUBRIC_FILE = join(__dirname, "..", "skill", "note-scoring.md");
const MIN_SCORE = 6;

const START_TEXT =
  "Send me a note — what you want the post to be about, plus any real numbers, mechanisms, or honest limitations you want in it. I'll draft it in your voice and send it back here for you to review before you post it to LinkedIn.";

export function createBot(env = process.env) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, GEMINI_MODEL } = env;

  if (!TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_CHAT_ID is not set — refusing to run without a chat allowlist");
  }

  const telegram = new TelegramClient(TELEGRAM_BOT_TOKEN);
  const drafter = new PostDrafter(GEMINI_API_KEY, GEMINI_MODEL, readFileSync(SKILL_FILE, "utf8"));
  const scorer = new NoteScorer(GEMINI_API_KEY, GEMINI_MODEL, readFileSync(RUBRIC_FILE, "utf8"));

  async function reply(text) {
    const { score, reason } = await scorer.score(text);
    console.log(`Score ${score}/10: ${reason}`);
    if (score < MIN_SCORE) {
      return `Rating: ${score}/10 - not for LinkedIn. No draft made.\n${reason}`;
    }
    const draft = await drafter.draft(text);
    return `Rating: ${score}/10 - good to post.\n${reason}\n\n${draft}`;
  }

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

    console.log(`Scoring note: ${text.slice(0, 80)}...`);
    await telegram.sendChatAction(chatId, "typing");

    try {
      const message = await withTimeout(reply(text), 50000, "Gemini took too long to respond");
      await telegram.sendMessage(chatId, message);
      console.log("Reply sent successfully.");
    } catch (err) {
      console.error("Draft generation failed:", err);
      await telegram.sendMessage(chatId, friendlyError(err));
    }
  }

  return { telegram, handleUpdate };
}

function friendlyError(err) {
  if (err.status === 429) {
    return "Gemini's usage limit was hit (the free tier allows 15 requests a minute). Please send the note again in a minute.";
  }
  return `Sorry, something went wrong with that note: ${String(err.message).slice(0, 200)}`;
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
