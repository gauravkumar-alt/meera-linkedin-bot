import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TelegramClient } from "./telegram.js";
import { PostDrafter, NoteScorer, KeywordExtractor, ClaimChecker } from "./gemini.js";
import { searchNews } from "./news.js";

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
  const skill = readFileSync(SKILL_FILE, "utf8");
  const knownFacts = skill.slice(skill.indexOf("## 2."), skill.indexOf("## 3."));
  const drafter = new PostDrafter(GEMINI_API_KEY, GEMINI_MODEL, skill);
  const scorer = new NoteScorer(GEMINI_API_KEY, GEMINI_MODEL, readFileSync(RUBRIC_FILE, "utf8"));
  const extractor = new KeywordExtractor(GEMINI_API_KEY, GEMINI_MODEL);
  const checker = new ClaimChecker(GEMINI_API_KEY, GEMINI_MODEL, knownFacts);

  async function claimsBlock(note, draft) {
    const post = draft.split(/\n-{3,}\s*\n/)[0];
    try {
      const flagged = await checker.unsupported(note, post);
      console.log(`Claim check: ${flagged.length} unsupported`);
      if (!flagged.length) return "Claim check: every statement about you or Skinstinct comes from your note or your known facts.";
      return [
        "______________________________",
        "CHECK THESE CLAIMS - not in your note or your known facts:",
        ...flagged.map((c) => `• ${c}`),
        "Edit or delete them before posting.",
        "______________________________",
      ].join("\n");
    } catch (err) {
      console.error("Claim check failed:", err.message);
      return "⚠ Claim check didn't run this time. Read every sentence about you or Skinstinct before posting.";
    }
  }

  // A news lookup failure should never block the draft.
  async function findNews(text) {
    try {
      const { keywords, phrase } = await extractor.extract(text);
      let items = await searchNews(phrase);
      console.log(`News search "${phrase}": ${items.length} results`);
      if (!items.length && keywords.length) {
        // Google News requires every word to match, so a specific phrase often returns nothing.
        const broader = keywords.slice(0, 3).map((k) => `"${k}"`).join(" OR ");
        items = await searchNews(broader);
        console.log(`Broader news search ${broader}: ${items.length} results`);
      }
      return items;
    } catch (err) {
      console.error("News lookup failed, drafting without news:", err.message);
      return [];
    }
  }

  async function reply(text) {
    const { score, reason } = await scorer.score(text);
    console.log(`Score ${score}/10: ${reason}`);
    if (score < MIN_SCORE) {
      return `Rating: ${score}/10 - not for LinkedIn. No draft made.\n${reason}`;
    }

    const newsItems = await findNews(text);
    const { text: draft, newsUsed } = await drafter.draft(text, newsItems);
    console.log(newsUsed ? `News used: ${newsUsed.headline}` : "No news item used.");

    let message = `Rating: ${score}/10 - good to post.\n${reason}\n\n${draft}`;
    message += `\n\n${await claimsBlock(text, draft)}`;
    if (newsUsed) {
      message += `\n\n${verifyFlag(newsUsed)}`;
    } else if (newsItems.length) {
      message += `\n\nNews checked (${newsItems.length} recent articles) - none fit naturally, so the post doesn't use one.`;
    }
    return message;
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

function verifyFlag(item) {
  const rule = "______________________________";
  return [
    rule,
    `NEWS SOURCE: ${item.headline}`,
    `FROM: ${item.source} · ${item.date}`,
    `LINK: ${item.link}`,
    "⚠ Check this before publishing - you are the author of this claim",
    rule,
  ].join("\n");
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
