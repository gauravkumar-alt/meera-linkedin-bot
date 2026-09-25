// Local long-polling mode. Won't receive anything while a webhook is set (Telegram returns 409).
import "dotenv/config";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createBot } from "./bot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "..", ".state.json");

const { telegram, handleUpdate } = createBot();

function loadOffset() {
  if (!existsSync(STATE_FILE)) return undefined;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")).offset;
  } catch {
    return undefined;
  }
}

function saveOffset(offset) {
  writeFileSync(STATE_FILE, JSON.stringify({ offset }), "utf8");
}

async function main() {
  console.log("Meera LinkedIn post bot starting (long polling)...");
  let offset = loadOffset();

  while (true) {
    let updates;
    try {
      updates = await telegram.getUpdates(offset, 30);
    } catch (err) {
      console.error("getUpdates failed, retrying in 5s:", err.message);
      await sleep(5000);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      saveOffset(offset);
      await handleUpdate(update);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
