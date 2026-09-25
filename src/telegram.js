const API_ROOT = "https://api.telegram.org";

export class TelegramClient {
  constructor(botToken) {
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    this.base = `${API_ROOT}/bot${botToken}`;
  }

  async call(method, payload) {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram API error on ${method}: ${data.description ?? res.status}`);
    }
    return data.result;
  }

  // Long-poll for new updates. Blocks up to `timeout` seconds server-side.
  async getUpdates(offset, timeout = 30) {
    return this.call("getUpdates", { offset, timeout, allowed_updates: ["message", "channel_post"] });
  }

  async sendMessage(chatId, text) {
    // Telegram caps messages at 4096 chars; chunk defensively just in case.
    const chunks = splitForTelegram(text);
    for (const chunk of chunks) {
      await this.call("sendMessage", { chat_id: chatId, text: chunk });
    }
  }

  async sendChatAction(chatId, action = "typing") {
    try {
      await this.call("sendChatAction", { chat_id: chatId, action });
    } catch {
      // best-effort only
    }
  }
}

function splitForTelegram(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
