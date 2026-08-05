/**
 * Intent detection + pipeline selection.
 * User → intent → memory → search → vision → documents → code → LLM → response.
 * Purely capability based: it never names a specific vendor.
 */

import { identityClause } from "../services/identity.js";

const R = {
  live: /\b(latest|today|tonight|current|currently|now|recent|live|price|stock|crypto|exchange rate|score|match|result|standings|news|headline|breaking|weather|temperature|forecast|aqi|who won|release date|near me|trending|20(2[4-9]|3\d))\b/i,
  image: /\b(generate|create|make|draw|design|render)\b.{0,20}\b(image|picture|photo|logo|illustration|poster|wallpaper|art)\b/i,
  website: /\b(website|landing page|web ?page|portfolio site|html page)\b/i,
  code: /\b(code|function|component|bug|error|refactor|typescript|javascript|python|react|jsx|api|sql|algorithm|regex|debug|stack trace)\b|```/i,
  compare: /\b(compare|comparison|difference|differences|diff|versus|vs\.?)\b/i,
  research: /\b(research|deep dive|analyz|report on|pros and cons)\b/i,
  explicit:
    /\b(search( the)?( web| online| internet| google)?|google (it|this)|look (it )?up|browse|web ?search|check online|cite sources)\b/i,
  product:
    /\b(iphone|ipad|macbook|galaxy|pixel|oneplus|xiaomi|redmi|playstation|ps5|xbox|rtx|snapdragon|tesla)\b/i,
  latest: /\b(latest|newest|current|most recent|new model)\b/i,
};

/** True when a question genuinely needs live data (never for uploads). */
export function needsLive(prompt = "") {
  if (R.explicit.test(prompt)) return true;
  if (R.live.test(prompt)) return true;
  return R.product.test(prompt) && R.latest.test(prompt);
}

export function detectIntent({ prompt = "", hasImage = false, docCount = 0 } = {}) {
  if (hasImage) return "vision";
  if (docCount >= 2 && R.compare.test(prompt)) return "compare";
  // Uploaded documents answer from their own text, never from the web.
  if (docCount) return R.code.test(prompt) ? "code" : "summarize";
  if (R.image.test(prompt)) return "image";
  if (R.website.test(prompt)) return "website";
  if (needsLive(prompt)) return "search";
  if (R.research.test(prompt)) return "research";
  if (R.code.test(prompt)) return "code";
  if (docCount) return "summarize";
  return "chat";
}

/** Which capability handles this intent, and does it need grounding first? */
export function planFor(intent) {
  switch (intent) {
    case "vision":
      return { capability: "vision", search: false };
    case "image":
      return { capability: "image", search: false };
    case "search":
    case "research":
      return { capability: "chat", search: true };
    default:
      return { capability: "chat", search: false };
  }
}

export const PERSONAS = {
  document:
    "DOCUMENT MODE: the user's uploaded document text is in the context. Answer strictly from it, quote the " +
    "relevant lines, never treat the filename as the question, never search the web, and never list sources.",
  base:
    "You are the assistant — a warm, precise, senior assistant with strong reasoning. Lead with the answer, " +
    "then the reasoning. Use markdown. Cite supplied live context as [1], [2]. Never invent time-sensitive " +
    "facts; if live context is missing for such a question, say the lookup failed. Address the user by name.",
  code:
    "ENGINEERING MODE: ship complete, runnable, production-ready files with every dependency and config listed. " +
    "No placeholders or TODOs. Prefix each file block with its path. Include error, loading and empty states.",
  website:
    "You are SYNEZ Web Engine. Return ONE ```html block containing a full responsive document with inline " +
    "<style> and <script> that runs instantly in an iframe.",
  vision:
    "You are SYNEZ Vision. Do OCR, UI/screenshot analysis, error detection, chart extraction and object " +
    "recognition. Answer the user's question first, then add the extracted detail.",
  compare:
    "You are SYNEZ Compare. Use only the supplied documents/diff. Never suggest external comparison tools. " +
    "Give a verdict, a difference table, and 'only in A' / 'only in B' lists.",
};

export function personaFor(intent) {
  return `${identityClause()}\n\n${basePersonaFor(intent)}`;
}

function basePersonaFor(intent) {
  if (intent === "code") return `${PERSONAS.base}\n\n${PERSONAS.code}`;
  if (intent === "website") return `${PERSONAS.base}\n\n${PERSONAS.website}`;
  if (intent === "vision") return `${PERSONAS.base}\n\n${PERSONAS.vision}`;
  if (intent === "compare") return `${PERSONAS.base}\n\n${PERSONAS.compare}`;
  if (intent === "summarize") return `${PERSONAS.base}\n\n${PERSONAS.document}`;
  return PERSONAS.base;
}

export function nowContext() {
  return `Current server date/time: ${new Date().toUTCString()}.`;
}
