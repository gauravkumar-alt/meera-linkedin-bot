import { createBot } from "../src/bot.js";

let bot;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("Meera bot webhook is up.");
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    res.status(401).send("Unauthorized");
    return;
  }

  bot ??= createBot();

  try {
    await bot.handleUpdate(req.body ?? {});
  } catch (err) {
    console.error("Unhandled error processing update:", err);
  }

  // Always 200: a non-2xx makes Telegram redeliver the update, which would draft twice.
  res.status(200).json({ ok: true });
}
