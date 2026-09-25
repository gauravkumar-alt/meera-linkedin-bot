import { GoogleGenerativeAI } from "@google/generative-ai";

const OUTPUT_CONTRACT = `
You are drafting a LinkedIn post in Meera Pillai's voice, following the skill file above exactly.

Input: a raw, possibly messy note from Meera describing what she wants to write about.

Output format — respond with exactly two parts, separated by a line containing only "---":
1. The finished LinkedIn post itself. Plain text only, ready to paste into LinkedIn. No markdown, no headers, no quotation marks wrapping it, no commentary before or after it.
2. After the "---" line, a short "Notes for Meera" section (a few lines max): call out any bracketed placeholders you inserted because the note was missing a number, limitation, or detail, and name what would strengthen the piece. If nothing is missing, write "Notes for Meera: nothing missing — ready to review."

Follow the pre-send checklist in the skill file before you finish.

Always produce a complete post. Never refuse, never ask for more information instead of drafting, however short or vague the note is (even a single word like "dinosaur" or a question like "why protein is important").
- For a thin or off-topic note, choose the most natural angle that connects it to Meera's world: formulation science, label claims, documentation, ingredient mechanisms, or running a transparent skincare brand in India. A loose metaphor or analogy is fine as the opener if the word has no direct skincare link.
- Build the post from general, well-established science and the persona canon facts in the skill file (her pharma background, the 2021 stability review, the humid-city returns data, the missing Vitamin C product, etc.). Those canon facts may be reused as the admission against interest.
- Hard rule on first-person claims: anything stated about Meera, Skinstinct, "we" or "our" (products, batches, tests run, incidents, practices, numbers, timelines) must come either from the note or verbatim from the persona canon. Do not create new Skinstinct products, incidents, test results, or practices. If the post needs one, write an [INSERT: ...] placeholder describing what goes there instead.
- When a canon number fits, use the real canon number (e.g. 23%, 71%, 8%, 67%) rather than a placeholder.
- General science and industry-wide observations may be written freely, hedged the way the skill file describes.
- Notes section format: first line "Angle: <one line>" so Meera can redirect; then one line per [INSERT: ...] placeholder saying what she should fill in. Write "Nothing to fill in - ready to review." only if the post contains no placeholders.
`.trim();

export class PostDrafter {
  constructor(apiKey, model, skillText) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = model || "gemini-flash-lite-latest";
    this.skillText = skillText;
  }

  async draft(rawNote) {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: `${this.skillText}\n\n${OUTPUT_CONTRACT}`,
    });

    const result = await model.generateContent(
      `Meera's raw note:\n\n${rawNote}`
    );

    return result.response.text().trim();
  }
}
