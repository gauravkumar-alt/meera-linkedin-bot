# Meera → LinkedIn post bot

Meera posts a raw note in the "Gk notes" Telegram channel. Gemini drafts a LinkedIn
post in her voice (per `skill/meera-voice.md`), and the bot replies in the channel
with the draft plus notes on anything she should fill in. Nothing is posted to
LinkedIn automatically.

## How it runs

Production runs on Vercel as a Telegram webhook: `api/telegram.js`. Telegram calls it
for each new channel post; it drafts and replies before returning 200.

`src/bot.js` holds the shared logic (chat allowlist, `/start`, drafting, replying).
`src/index.js` is a local long-polling runner for debugging only. It won't receive
anything while the webhook is set, so delete the webhook first if you need it.

## Note scoring

Before drafting, Gemini scores each note 0-10 against `skill/note-scoring.md`
(is it a post idea, is there a point, does it fit her pillars, is there real
material, is it on-brand). Below 6, the bot replies with the score and reason and
stops; 6 or above, it drafts. The rating is always the first line of the reply. Edit that file to change what
counts as postworthy; the threshold is `MIN_SCORE` in `src/bot.js`.

## News angle

For notes that pass scoring, Gemini pulls 3-5 keywords into a short search phrase,
and `src/news.js` searches Google News' public RSS feed (India edition, last 30
days, no key needed). The top 5 results go to the drafter, which uses one only if it
genuinely fits. Any draft that cites an article gets a verify block (headline,
publication, date, link) built by the code from the feed, not written by the model.
If the post mentions an article's headline or publication, the block is added even
if the model said it used none. If the news lookup fails, the draft goes ahead
without news.

The feed only carries headline, publication, date and link, not article text, so
the drafter is told not to state anything beyond the headline.

## Environment variables

Set these in Vercel (Project → Settings → Environment Variables), and in `.env` for
local use (see `.env.example`):

- `TELEGRAM_BOT_TOKEN`: from @BotFather
- `TELEGRAM_CHAT_ID`: the only chat the bot responds in
- `TELEGRAM_WEBHOOK_SECRET`: random string; Telegram sends it in a header so the
  endpoint can reject anyone else
- `GEMINI_API_KEY`
- `GEMINI_MODEL`: defaults to `gemini-flash-lite-latest`

## Deploy

Pushes to `main` deploy automatically once the GitHub repo is connected in Vercel.
After the first deploy (or if the URL changes), register the webhook once:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="https://<your-vercel-domain>/api/telegram" \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","channel_post"]'
```

Check it with `getWebhookInfo`. To go back to local polling, call `deleteWebhook`.
