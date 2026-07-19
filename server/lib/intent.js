/* =========================
   INTENT CLASSIFICATION
   Deterministic master orchestrator + build-request detectors.
========================= */

const { hasImagePayload } = require("./imageUtils");

function isProjectBuildRequest(text = "") {
  const t = String(text || "").toLowerCase();

  // Known app/clone keywords are always project mode.
  if (/(netflix|spotify|youtube|instagram|whatsapp|uber|zomato|amazon|flipkart|twitter|x clone|facebook|discord|telegram|notion|trello|slack).*clone/i.test(t)) return true;
  if (/(clone).*(netflix|spotify|youtube|instagram|whatsapp|uber|zomato|amazon|flipkart|twitter|facebook|discord|telegram|notion|trello|slack)/i.test(t)) return true;

  const buildIntent = /(build|create|make|generate|develop|code|banao|bnao|bnado)/i.test(t);
  const projectWords =
    /(clone|app|application|platform|workspace|ai workspace|system|dashboard|portal|full project|complete project|multi[-\s]?file|react project|vite project|node project|full stack|frontend project|backend project|spotify|netflix|youtube|instagram|whatsapp|todo app|chat app|ecommerce app|crm|lms|portfolio app)/i.test(t);

  const pureWebsiteOnly =
    /(website|landing page|homepage|webpage)/i.test(t) &&
    !/(react|vite|full stack|backend|node|express|database|auth|dashboard|app|clone|multi[-\s]?file|project|platform|system)/i.test(t);

  return buildIntent && projectWords && !pureWebsiteOnly;
}

function isWebsiteBuildRequest(text = "") {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;

  // Project/app/clone prompts must never fall into Website Architect.
  if (isProjectBuildRequest(t)) return false;

  // A website noun MUST be present. "site" alone is intentionally excluded
  // because it appears inside unrelated words and casual chat too often.
  const websiteNoun =
    /\b(website|web\s?page|landing\s?page|home\s?page|portfolio\s?(?:website|site)|saas\s?page|frontend\s?page)\b/i;
  if (!websiteNoun.test(t)) return false;

  // Genuine creation verbs only. Merely mentioning "website" is NOT a build request.
  const buildVerb =
    /\b(build|create|make|generate|design|develop|banao|bnao|bna\s?do|bana\s?do|bnado|banade|bana\s?de|banwa\s?do)\b/i;

  // Talking ABOUT an existing site ("my website", "this webpage", "the landing page")
  // is normal conversation, not a request to generate a new one.
  const refersToExisting =
    /\b(my|your|our|this|that|the|existing|current|is|iss|apni|apne|meri|mera|mere)\s+(website|web\s?page|landing\s?page|home\s?page)\b/i;

  // Explicit "make me a website" style always wins even with a possessive nearby.
  const explicitBuildMe =
    /\b(build|create|make|generate|design|develop)\s+(me\s+)?(a\s+|an\s+|one\s+)?(new\s+)?(website|web\s?page|landing\s?page|home\s?page|portfolio)\b/i;
  const hinglishBuild =
    /(website|web\s?page|landing\s?page|home\s?page|portfolio)\s+(banao|bnao|bna\s?do|bana\s?do|bnado|banade|bana\s?de|banwa\s?do)\b/i;

  if (explicitBuildMe.test(t) || hinglishBuild.test(t)) return true;
  if (refersToExisting.test(t)) return false;

  return buildVerb.test(t);
}

function isRuntimeSelfHealRequest(text = "") {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;

  const explicitEngine = /runtime self[-\s]?healing|self[-\s]?heal(?:ing)? preview|runtime repair engine/i.test(t);
  const runtimeFailure = /preview (?:has )?(?:crashed|failed|broken|blank)|blank preview|runtime (?:error|failure|crash)|vite (?:error|failed)|react (?:runtime )?error|console error|failed to compile|cannot resolve|is not defined|unexpected token/i.test(t);
  const repairIntent = /repair|heal|fix|recover|rebuild preview|reload preview|verify (?:the )?(?:repair|preview)/i.test(t);
  const projectScope = /current (?:running )?project|currently loaded project|remembered project|project files|codebase|preview|runtime/i.test(t);

  return explicitEngine || (runtimeFailure && (repairIntent || projectScope));
}

function isGenerateProjectRequest(text = "") {
  return /^(generate|generate files|generate project|create files|start generation|build files)$/i.test(
    String(text || "").trim()
  );
}

/* =========================
   PHASE 7.0 MASTER AI ORCHESTRATOR
   One prompt = one engine. This classifier is deterministic and does not call an AI model.
========================= */

const MASTER_INTENTS_V7 = new Set([
  "runtime-self-heal",
  "project-memory",
  "coding-agent",
  "architecture",
  "website",
  "image-edit",
  "image-generation",
  "document-reader",
  "quick-info",
  "web-search",
  "chat",
]);

function normalizeIntentTextV7(text = "") {
  return String(text || "")
    .replace(/Uploaded attachments:[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function classifyMasterIntentV7(text = "", context = {}) {
  const t = normalizeIntentTextV7(text);
  const hasImages = Boolean(context.hasImages || context.imageCount > 0 || hasImagePayload(context.imageData));
  const hasDocuments = Boolean(context.hasDocuments || context.fileCount > 0);
  const explicitTask = String(context.explicitTask || "").toLowerCase();
  const scores = {
    "runtime-self-heal": 0,
    "project-memory": 0,
    "coding-agent": 0,
    architecture: 0,
    website: 0,
    "image-edit": 0,
    "image-generation": 0,
    "document-reader": 0,
    "quick-info": 0,
    "web-search": 0,
    chat: 1,
  };
  const reasons = [];
  const add = (intent, points, reason) => {
    scores[intent] += points;
    if (reason) reasons.push({ intent, points, reason });
  };

  // Explicit route locks always win and are used by regenerate/retry.
  if (MASTER_INTENTS_V7.has(explicitTask)) {
    add(explicitTask, 1000, "Explicit task lock supplied by the client");
  }

  const runtimeExplicit = /runtime self[-\s]?healing|self[-\s]?heal(?:ing)? preview|runtime repair engine|use only the runtime/i.test(t);
  const runtimeEvidence = /preview (?:has )?(?:crashed|failed|broken|blank)|blank preview|runtime (?:error|failure|crash)|vite (?:error|failed)|react (?:runtime )?error|console error|failed to compile|cannot resolve|is not defined|unexpected token|build error/i.test(t);
  const runtimeAction = /inspect|repair|heal|fix|recover|rebuild|reload|verify/i.test(t);
  if (runtimeExplicit) add("runtime-self-heal", 160, "Explicit Runtime Self-Healing request");
  if (runtimeEvidence && runtimeAction) add("runtime-self-heal", 95, "Runtime evidence plus repair/inspection action");

  const memoryScope = /project memory|remember(?:ed)? project|active workspace|save (?:the )?(?:current )?project|restore snapshot|project snapshot|latest snapshot/i.test(t);
  if (memoryScope) add("project-memory", 135, "Project-memory or snapshot request");

  const analyzeIntent = /\b(analyze|analyse|inspect|review|audit|dependency graph|project health|production readiness|engineering report|find bugs|debug|refactor|optimi[sz]e|broken imports?|missing imports?|codebase)\b/i.test(t);
  const currentProjectScope = /\b(current|existing|uploaded|remembered|this|entire|whole|complete)\s+(project|codebase)|project files|current synez/i.test(t);
  const applyFixIntent = /automatically fix|auto fix|apply (?:the )?fix|repair all|edit only|required files|refactor this project/i.test(t);
  if (analyzeIntent && currentProjectScope) add("coding-agent", 120, "Existing-project analysis or repair request");
  if (applyFixIntent) add("coding-agent", 35, "Explicit multi-file repair intent");

  const buildVerb = /\b(build|create|generate|develop|make|design|banao|bnao|bnado|bana\s?do|bna\s?do)\b/i.test(t);
  const projectObject = /\b(app|application|platform|workspace|dashboard|portal|clone|full[-\s]?stack|complete multi[-\s]?file|react project|vite project|software project|system)\b/i.test(t);
  const websiteObject = /\b(website|webpage|landing page|homepage)\b/i.test(t);
  // Referring to an existing site ("my website", "this webpage") is conversation, not a build order.
  const refersToExistingSite = /\b(my|your|our|this|that|the|existing|current|apni|apne|meri|mera|mere)\s+(website|webpage|landing page|homepage)\b/i.test(t);
  const negativeBuild = /do not (?:generate|build|create)|not a website generation request|not a project architecture request/i.test(t);
  if (buildVerb && projectObject && !negativeBuild && !analyzeIntent) add("architecture", 115, "New application/project generation request");
  // Website generation requires a genuine build verb, a website noun, and must not merely
  // reference an existing site. This keeps casual mentions of "website" in normal chat.
  if (buildVerb && websiteObject && !projectObject && !negativeBuild && !analyzeIntent && (!refersToExistingSite || isWebsiteBuildRequest(t))) {
    add("website", 105, "Standalone website generation request");
  }

  const imageEditWords = /\b(edit|replace background|change background|blur background|remove background|remove object|object removal|retouch|inpaint|enhance photo|color correct|colour correct)\b/i.test(t);
  if (hasImages && imageEditWords) add("image-edit", 145, "Uploaded image plus direct edit instruction");
  const imageGenWords = /\b(generate|create|make|draw|render)\b[\s\S]{0,30}\b(image|photo|poster|logo|wallpaper|artwork)\b/i.test(t);
  if (!hasImages && imageGenWords) add("image-generation", 100, "Text-to-image generation request");

  const readerWords = /\b(read|summarize|summarise|explain|extract|compare|analyze|analyse)\b[\s\S]{0,40}\b(document|pdf|docx|txt|markdown|file|attachments?)\b/i.test(t);
  if (hasDocuments && (readerWords || !t)) add("document-reader", 140, "Uploaded document reading request");

  const quickInfoWords = /\b(weather|mausam|temperature|forecast|humidity|wind|current time|today'?s date|today date|aaj ka date|aaj ka time|latest news|today'?s news|aaj ki news|khabar|samachar)\b/i.test(t);
  const engineeringContext = /runtime|project|codebase|dependency|build|preview|architecture|fix time|latest dependencies/i.test(t);
  if (quickInfoWords && !engineeringContext && !buildVerb) add("quick-info", 110, "Explicit live date/time/weather/news request");

  const freshInfoWords = /\b(latest|current|today|yesterday|recent|price|score|winner|news|update)\b/i.test(t);
  const explicitSearch = /\b(search the web|web search|look up|find online|sources|cite sources)\b/i.test(t);
  // A bare "today"/"latest" inside a statement is conversation. Only treat fresh-info
  // words as a search request when they come with an actual question/lookup cue.
  const infoSeekingCue = /\b(what|whats|what's|who|whom|when|where|which|why|how|kya|kaun|kab|kahan|kitna|kitne|tell me|find|search|show me|check)\b|\?/i.test(t);
  if ((explicitSearch || (freshInfoWords && infoSeekingCue)) && !buildVerb && !analyzeIntent && !quickInfoWords) add("web-search", explicitSearch ? 85 : 45, "Fresh/public-information request");

  // Strong mutual-exclusion penalties.
  if (runtimeExplicit || (runtimeEvidence && runtimeAction)) {
    scores.architecture -= 180;
    scores.website -= 180;
    scores["quick-info"] -= 120;
  }
  if (analyzeIntent && currentProjectScope) {
    scores.architecture -= 150;
    scores.website -= 150;
    scores["quick-info"] -= 100;
  }
  if (buildVerb && (projectObject || websiteObject) && !negativeBuild) {
    scores["quick-info"] -= 160;
    scores["coding-agent"] -= analyzeIntent ? 0 : 80;
    scores["runtime-self-heal"] -= runtimeExplicit ? 0 : 100;
  }

  const order = [
    "runtime-self-heal",
    "project-memory",
    "image-edit",
    "document-reader",
    "coding-agent",
    "architecture",
    "website",
    "quick-info",
    "web-search",
    "image-generation",
    "chat",
  ];
  const ranked = order
    .map((intent) => ({ intent, score: scores[intent] }))
    .sort((a, b) => b.score - a.score || order.indexOf(a.intent) - order.indexOf(b.intent));
  const winner = ranked[0];
  const second = ranked[1];
  const positiveReasons = reasons
    .filter((item) => item.intent === winner.intent && item.points > 0)
    .sort((a, b) => b.points - a.points)
    .map((item) => item.reason);

  return {
    intent: winner.intent,
    confidence: Math.max(1, Math.min(100, Math.round(55 + (winner.score - second.score) / 2))),
    reason: positiveReasons[0] || "General conversation fallback",
    scores,
    ranked: ranked.slice(0, 4),
    version: "7.0",
  };
}

function detectTaskType(text = "", explicitTask = "") {
  const result = classifyMasterIntentV7(text, { explicitTask });
  if (result.intent === "architecture") return "project";
  if (result.intent === "website") return "website";
  if (result.intent === "runtime-self-heal") return "runtime-self-heal";
  if (result.intent === "image-generation") return "image";
  return "chat";
}

module.exports = {
  MASTER_INTENTS_V7,
  normalizeIntentTextV7,
  classifyMasterIntentV7,
  detectTaskType,
  isProjectBuildRequest,
  isWebsiteBuildRequest,
  isRuntimeSelfHealRequest,
  isGenerateProjectRequest,
};
