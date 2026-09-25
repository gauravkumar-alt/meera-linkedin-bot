import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-flash-lite-latest";

function jsonModel(apiKey, model, systemInstruction, responseSchema) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: model || DEFAULT_MODEL,
    systemInstruction,
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema },
  });
}

const SCORE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    score: { type: SchemaType.INTEGER, description: "0-10" },
    reason: { type: SchemaType.STRING, description: "One line, addressed to Meera" },
  },
  required: ["score", "reason"],
};

export class NoteScorer {
  constructor(apiKey, model, rubricText) {
    this.model = jsonModel(apiKey, model, rubricText, SCORE_SCHEMA);
  }

  async score(rawNote) {
    const result = await this.model.generateContent(`Meera's raw note:\n\n${rawNote}`);
    const { score, reason } = JSON.parse(result.response.text());
    return { score: Math.max(0, Math.min(10, Math.round(Number(score)))), reason: String(reason).trim() };
  }
}

const KEYWORDS_PROMPT = `
You turn a note from a skincare founder in India into a Google News search.
Pull 3-5 search terms from the note, then combine the most important ones into one short search phrase (2-5 words) that would find recent news on the note's subject.
Use general subject terms (ingredients, regulations, claims, industry trends). Leave out anything internal to her company: batch numbers, "our", "we", the brand name Skinstinct, customer names.
`.trim();

const KEYWORDS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "3-5 search terms" },
    search_phrase: { type: SchemaType.STRING, description: "2-5 words for Google News" },
  },
  required: ["keywords", "search_phrase"],
};

export class KeywordExtractor {
  constructor(apiKey, model) {
    this.model = jsonModel(apiKey, model, KEYWORDS_PROMPT, KEYWORDS_SCHEMA);
  }

  async extract(rawNote) {
    const result = await this.model.generateContent(`Note:\n\n${rawNote}`);
    const { keywords, search_phrase } = JSON.parse(result.response.text());
    return { keywords: keywords.map(String), phrase: String(search_phrase).trim() };
  }
}

const OUTPUT_CONTRACT = `
You are drafting a LinkedIn post in Meera Pillai's voice, following the skill file above exactly.

Input: a raw, possibly messy note from Meera describing what she wants to write about, sometimes followed by recent news items.

Output format — respond with exactly two parts, separated by a line containing only "---":
1. The finished LinkedIn post itself. Plain text only, ready to paste into LinkedIn. No markdown, no headers, no quotation marks wrapping it, no commentary before or after it.
2. After the "---" line, a short "Notes for Meera" section (a few lines max), in the format described below.

Follow the pre-send checklist in the skill file before you finish.

Always produce a complete post. The note has already passed a quality screen, so never refuse and never ask for more information instead of drafting.
- For a thin or off-topic note, choose the most natural angle that connects it to Meera's world: formulation science, label claims, documentation, ingredient mechanisms, or running a transparent skincare brand in India. A loose metaphor or analogy is fine as the opener if the word has no direct skincare link.
- Build the post from general, well-established science and the persona canon facts in the skill file (her pharma background, the 2021 stability review, the humid-city returns data, the missing Vitamin C product, etc.). Those canon facts may be reused as the admission against interest.
- Hard rule on first-person claims: anything stated about Meera, Skinstinct, "we" or "our" (products, batches, tests run, incidents, practices, numbers, timelines) must come either from the note or verbatim from the persona canon. Do not create new Skinstinct products, incidents, test results, or practices. If the post needs one, write an [INSERT: ...] placeholder describing what goes there instead.
- When a canon number fits, use the real canon number (e.g. 23%, 71%, 8%, 67%) rather than a placeholder.
- General science and industry-wide observations may be written freely, hedged the way the skill file describes.
- Notes section format: first line "Angle: <one line>" so Meera can redirect; then one line per [INSERT: ...] placeholder saying what she should fill in. Write "Nothing to fill in - ready to review." only if the post contains no placeholders.
`.trim();

function newsBlock(newsItems) {
  const list = newsItems
    .map((item, i) => `[${i + 1}] "${item.headline}" - ${item.source}, ${item.date}`)
    .join("\n");
  return `
Recent news items from Google News (last 30 days). You only know each headline, publication and date, not the article contents.
${list}

If one of these news items is genuinely relevant, use it to make the post timely. If none fits naturally, ignore them.
- Use at most one item. Refer to it only by what its headline says and attribute it to its publication. Do not invent details, quotes, or numbers from the article. No URLs in the post.
- A market-research report, product listicle, or advertorial is not news; treat it as not relevant.
- After the Notes section, end your reply with one final line, exactly "NEWS_USED: <item number>" or "NEWS_USED: none".
`.trim();
}

export class PostDrafter {
  constructor(apiKey, model, skillText) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: model || DEFAULT_MODEL,
      systemInstruction: `${skillText}\n\n${OUTPUT_CONTRACT}`,
    });
  }

  // Returns { text, newsUsed } where newsUsed is the chosen item from newsItems, or null.
  async draft(rawNote, newsItems = []) {
    let prompt = `Meera's raw note:\n\n${rawNote}`;
    if (newsItems.length) prompt += `\n\n${newsBlock(newsItems)}`;

    const result = await this.model.generateContent(prompt);
    let text = result.response.text().trim();

    let newsUsed = null;
    const marker = text.match(/\n?[\s*_`]*NEWS_USED:\s*\[?\s*(\d+|none)\s*\]?[\s*_`]*$/i);
    if (marker) {
      text = text.slice(0, marker.index).trim();
      newsUsed = newsItems[Number(marker[1]) - 1] ?? null;
    }
    // Backstop: a post that cites an article must carry the verify flag even if the marker was wrong.
    newsUsed ??= newsItems.find((item) => mentions(text, item)) ?? null;
    return { text, newsUsed };
  }
}

function mentions(text, item) {
  const haystack = text.toLowerCase();
  const headlineStart = item.headline.toLowerCase().slice(0, 30);
  const source = item.source.toLowerCase();
  return haystack.includes(headlineStart) || (source.length > 3 && haystack.includes(source));
}
