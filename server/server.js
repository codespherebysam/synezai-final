const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.get("/", (req, res) => {
  res.send("SYNEZ AI Server Running");
});

// Health endpoint for frontend route checks
app.get("/health", (req, res) => {
  res.json({ success: true, server: "SYNEZ AI", status: "running" });
});


const MEMORY_FILE = "memory.json";

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, "{}");
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function memoryToText(userEmail = "guest") {
  const allMemory = loadMemory();
  const userMemory = allMemory[userEmail] || {};
  const entries = Object.entries(userMemory);

  if (!entries.length) return "No saved memory yet.";
  return entries.map(([key, value]) => `${key}: ${value}`).join("\n");
}

app.get("/memory", (req, res) => {
  const userEmail = req.query.userEmail || "guest";
  const memory = loadMemory();
  res.json(memory[userEmail] || {});
});

app.post("/memory/save", (req, res) => {
  try {
    const { userEmail, key, value } = req.body;

    if (!userEmail || !key || !value) {
      return res.status(400).json({
        success: false,
        error: "userEmail, key and value are required.",
      });
    }

    const memory = loadMemory();
    if (!memory[userEmail]) memory[userEmail] = {};

    memory[userEmail][key] = value;
    saveMemory(memory);

    res.json({
      success: true,
      memory: memory[userEmail],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/memory/forget", (req, res) => {
  try {
    const { userEmail, key } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: "userEmail is required.",
      });
    }

    const memory = loadMemory();
    if (!memory[userEmail]) memory[userEmail] = {};

    if (key) delete memory[userEmail][key];
    else memory[userEmail] = {};

    saveMemory(memory);

    res.json({
      success: true,
      memory: memory[userEmail],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const groqModels = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "gemma2-9b-it",
];

const geminiModels = ["gemini-2.5-flash"];

const createSystemPrompt = (userName = "User", userEmail = "guest") => `
You are SYNEZ AI — Synergized Neural Intelligence at its Peak.

You are a professional AI assistant created and developed by Sameer Khan.

Identity Rules:
1. Do not introduce yourself in normal answers.
2. Never start normal answers with "I am SYNEZ AI".
3. Mention your name only when the user directly asks who you are, what you are, or who created you.
4. If user asks who you are, reply naturally: "I am SYNEZ AI — Synergized Neural Intelligence at its Peak."
5. If user asks who created you, reply: "SYNEZ AI was created and developed by Sameer Khan."

Current logged-in user's name is "${userName}".
Current logged-in user's email is "${userEmail}".

Relevant User Memory:
${memoryToText(userEmail)}

Memory Rules:
1. Use saved memory only for the current logged-in user.
2. Use memory naturally only when relevant.
3. Do not dump memory unless the user asks what you remember.

Language Rules:
1. Default response language is professional English.
2. If user writes in Hinglish, reply in Hinglish using Roman English letters only.
3. If user writes in pure Hindi, reply in Hindi.
4. If user asks "Hinglish me bolo", reply in Roman Hinglish.
5. If user asks "English me bolo", reply in English.

General Rules:
1. Answer directly and professionally.
2. Do not repeat your identity.
3. Do not say you cannot read uploaded PDF/DOCX if document text is present in the user message.
4. For document comparison, compare the extracted text already present in the prompt.
5. For website/code requests, return valid preview-ready code blocks.
`;


function cleanMessages(messages) {
  return messages.slice(-6).map((msg) => ({
    role: msg.role,
    content:
      msg.content?.length > 3500
        ? msg.content.slice(0, 3500) + "\n\n[Message trimmed]"
        : msg.content || "",
  }));
}

function getLastUserMessage(messages) {
  return [...messages].reverse().find((m) => m.role === "user")?.content || "";
}

function isImageGenerationRequest(text = "") {
  const t = text.toLowerCase();

  return [
    "generate image",
    "create image",
    "make image",
    "draw image",
    "render image",
    "image generate",
    "image banao",
    "photo banao",
    "pic banao",
    "picture banao",
    "poster banao",
    "logo banao",
    "wallpaper banao",
    "generate photo",
    "create photo",
    "generate poster",
    "create poster",
    "generate logo",
    "create logo",
    "generate wallpaper",
    "create wallpaper",
    "artwork",
  ].some((word) => t.includes(word));
}

async function callGroq(model, safeMessages, systemPrompt) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Groq API error");
  }

  return data?.choices?.[0]?.message?.content || "No response from Groq.";
}

async function callOpenRouter(model, safeMessages, systemPrompt) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "SYNEZ AI",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenRouter API error");
  }

  return data?.choices?.[0]?.message?.content || "No response from OpenRouter.";
}

function normalizeImageDataList(imageData = null) {
  if (Array.isArray(imageData)) {
    return imageData.filter((item) => item?.base64 && item?.mimeType);
  }

  return imageData?.base64 && imageData?.mimeType ? [imageData] : [];
}

function hasImagePayload(imageData = null) {
  return normalizeImageDataList(imageData).length > 0;
}

async function callGemini(model, safeMessages, systemPrompt, imageData = null) {
  const conversationText = safeMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const parts = [
    {
      text: `${systemPrompt}

Conversation:
${conversationText}`,
    },
  ];

  normalizeImageDataList(imageData).slice(0, 8).forEach((image) => {
    if (image.name) {
      parts.push({ text: `Uploaded image: ${image.name}` });
    }

    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.base64,
      },
    });
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini API error");
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";
}

/* =========================
   SEARCH SYSTEM
   Serper + Wikipedia
========================= */

const SERPER_KEYS = [
  process.env.SERPER_API_KEY,
  process.env.SERPER_API_KEY_1,
  process.env.SERPER_API_KEY_2,
  process.env.SERPER_API_KEY_3,
  process.env.SERPER_API_KEY_4,
].filter(Boolean);

let serperIndex = 0;

function getSerperKey() {
  if (!SERPER_KEYS.length) return null;

  const key = SERPER_KEYS[serperIndex];
  serperIndex = (serperIndex + 1) % SERPER_KEYS.length;

  return key;
}

function cleanSnippet(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldUseWikipedia(query = "") {
  const q = query.toLowerCase();

  return (
    q.includes("who is") ||
    q.includes("what is") ||
    q.includes("history") ||
    q.includes("about") ||
    q.includes("explain") ||
    q.includes("meaning")
  );
}

async function searchWikipedia(query, limit = 5) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&format=json&origin=*`;

    const response = await fetch(url);
    const data = await response.json();

    const results = data?.query?.search || [];

    const keywords = query
      .toLowerCase()
      .split(" ")
      .map((word) => word.trim())
      .filter(Boolean)
      .filter(
        (word) =>
          !["who", "is", "what", "the", "a", "an", "of", "in", "on", "for"].includes(word)
      );

    const filtered = results.filter((item) => {
      const title = (item.title || "").toLowerCase();
      const snippet = cleanSnippet(item.snippet || "").toLowerCase();

      if (!keywords.length) return true;

      return keywords.some(
        (word) => title.includes(word) || snippet.includes(word)
      );
    });

    return filtered.slice(0, limit).map((item) => ({
      title: item.title || "Wikipedia Result",
      snippet: cleanSnippet(item.snippet || ""),
      link: `https://en.wikipedia.org/wiki/${encodeURIComponent(
        item.title.replaceAll(" ", "_")
      )}`,
      displayLink: "wikipedia.org",
      sourceType: "Wikipedia",
    }));
  } catch (error) {
    console.log("WIKIPEDIA ERROR:", error.message);
    return [];
  }
}

async function searchSerper(query, num = 8) {
  try {
    const apiKey = getSerperKey();

    if (!apiKey) {
      console.log("No Serper API key found");
      return [];
    }

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        gl: "in",
        hl: "en",
        num,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("SERPER ERROR:", data);
      return [];
    }

    const results = [];

    if (data.answerBox) {
      results.push({
        title: data.answerBox.title || "Answer Box",
        snippet:
          data.answerBox.answer ||
          data.answerBox.snippet ||
          data.answerBox.description ||
          "",
        link: data.answerBox.link || "",
        displayLink: data.answerBox.source || "Google Answer",
        sourceType: "Answer Box",
      });
    }

    if (Array.isArray(data.news)) {
      data.news.forEach((item) => {
        results.push({
          title: item.title || "",
          snippet: item.snippet || item.date || "",
          link: item.link || "",
          displayLink: item.source || "",
          sourceType: "News",
        });
      });
    }

    if (Array.isArray(data.organic)) {
      data.organic.forEach((item) => {
        results.push({
          title: item.title || "",
          snippet: item.snippet || "",
          link: item.link || "",
          displayLink: item.displayLink || "",
          sourceType: "Web",
        });
      });
    }

    return results
      .filter((r) => r.title || r.snippet)
      .filter((r) => r.link)
      .slice(0, num);
  } catch (error) {
    console.log("SERPER SEARCH ERROR:", error.message);
    return [];
  }
}

function mergeUniqueResults(results = []) {
  const seen = new Set();
  const unique = [];

  for (const item of results) {
    const key = item.link || item.title;

    if (!key || seen.has(key)) continue;

    seen.add(key);
    unique.push(item);
  }

  return unique;
}


/* =========================
   INTENT ROUTER V2 HELPERS
   Weather / Time / Date / Local News must run before project architecture.
========================= */

function isTimeDateWeatherNewsRequest(text = "") {
  const t = String(text || "").toLowerCase();

  // Phase 6.3 guard: words such as "runtime", "estimated fix time" and
  // "latest dependencies" inside engineering prompts are not live-info intents.
  const codingContext = /\b(analyze|analyse|inspect|review|project health|dependency graph|runtime error|syntax error|logic error|broken import|missing import|codebase|current project|uploaded project|refactor|production readiness|estimated fix time)\b/i.test(t);
  const buildContext = /\b(build|create|generate|develop|make)\b[\s\S]{0,80}\b(app|application|platform|workspace|website|project|dashboard|portal|clone|system)\b/i.test(t);
  if (codingContext || buildContext) return false;

  const asksDateTime = /\b(date|time|day|today|aaj|aj|samay|waqt|tarikh|tareekh)\b/i.test(t);
  const asksWeather = /\b(weather|mausam|temperature|temp|rain|barish|humidity|wind|forecast)\b/i.test(t);
  const asksNews = /\b(news|khabar|khabrein|samachar|latest|aaj ki news|today news|hua|kya kya hua)\b/i.test(t);
  const hasLocalContext = /\b(dhanbad|jharkhand|india|near me|local|city)\b/i.test(t);

  return asksWeather || asksNews || (asksDateTime && (hasLocalContext || asksWeather || asksNews));
}

function extractLikelyLocation(text = "") {
  const t = String(text || "");
  const known = ["Dhanbad", "Jharkhand", "Ranchi", "Bokaro", "Jamshedpur", "Delhi", "Mumbai", "Kolkata", "Bengaluru", "India"];
  const found = known.find((name) => new RegExp(`\\b${name}\\b`, "i").test(t));
  if (found === "Jharkhand") return "Dhanbad, Jharkhand";
  if (found === "India") return "Dhanbad, Jharkhand";
  return found || "Dhanbad, Jharkhand";
}

function getIndiaDateTimeParts() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const dateOnly = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const timeOnly = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);

  const weekday = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  }).format(now);

  return {
    full: formatter.format(now),
    dateOnly,
    timeOnly,
    weekday,
  };
}

async function getWeatherSummary(location = "Dhanbad, Jharkhand") {
  try {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const response = await fetch(url);
    const data = await response.json();
    const current = data.current_condition?.[0];
    const area = data.nearest_area?.[0];

    if (!current) return null;

    return {
      location: area?.areaName?.[0]?.value || location,
      country: area?.country?.[0]?.value || "",
      temperature: current.temp_C,
      feelsLike: current.FeelsLikeC,
      condition: current.weatherDesc?.[0]?.value,
      humidity: current.humidity,
      wind: current.windspeedKmph,
      source: "wttr.in",
    };
  } catch (error) {
    console.log("QUICK WEATHER ERROR:", error.message);
    return null;
  }
}

function isLowQualitySource(item = {}) {
  const source = `${item.displayLink || ""} ${item.link || ""}`.toLowerCase();
  return /instagram|youtube|facebook|tiktok|shorts|pinterest|reddit/.test(source);
}

async function getLocalNewsResults(location = "Dhanbad, Jharkhand") {
  const query = `latest ${location} news today -instagram -facebook -youtube -shorts`;
  const results = await searchSerper(query, 10);
  return results
    .filter((item) => !isLowQualitySource(item))
    .slice(0, 6);
}

async function buildQuickInfoResponse(userPrompt = "") {
  const location = extractLikelyLocation(userPrompt);
  const wantsNews = /\b(news|khabar|khabrein|samachar|latest|hua|kya kya hua)\b/i.test(userPrompt);
  const wantsWeather = /\b(weather|mausam|temperature|temp|rain|barish|humidity|wind|forecast)\b/i.test(userPrompt);
  const dateTime = getIndiaDateTimeParts();
  const weather = wantsWeather || /dhanbad|jharkhand/i.test(userPrompt)
    ? await getWeatherSummary(location)
    : null;
  const news = wantsNews ? await getLocalNewsResults(location) : [];

  const lines = [];
  lines.push(`### ${location} — Today`);
  lines.push(`**Date:** ${dateTime.dateOnly}`);
  lines.push(`**Day:** ${dateTime.weekday}`);
  lines.push(`**Current Time:** ${dateTime.timeOnly} IST`);

  if (weather) {
    lines.push("");
    lines.push("### Weather");
    lines.push(`- **Condition:** ${weather.condition || "N/A"}`);
    lines.push(`- **Temperature:** ${weather.temperature}°C`);
    lines.push(`- **Feels like:** ${weather.feelsLike}°C`);
    lines.push(`- **Humidity:** ${weather.humidity}%`);
    lines.push(`- **Wind:** ${weather.wind} km/h`);
  }

  if (wantsNews) {
    lines.push("");
    lines.push("### Verified Local News");

    if (news.length) {
      news.slice(0, 5).forEach((item, index) => {
        lines.push(`${index + 1}. **${item.title || "News update"}** — ${item.snippet || "Open the source for details."}`);
      });
      lines.push("");
      lines.push("_News items are based only on retrieved web sources. SYNEZ AI did not invent any local event._");
    } else {
      lines.push("I could not retrieve reliable fresh local news results right now. I will not invent news. Try again later or ask for Jharkhand/India news.");
    }
  }

  return {
    reply: lines.join("\n"),
    provider: wantsNews ? "SYNEZ AI Search + Weather" : "SYNEZ AI Weather/Time",
    model: "Intent Router v2",
    task: "quick-info",
    sources: [
      ...(weather ? [{ title: "Weather source", snippet: "Current weather data", displayLink: "wttr.in", link: `https://wttr.in/${encodeURIComponent(location)}` }] : []),
      ...news,
    ],
  };
}

function wantsImageEdit(text = "") {
  const t = String(text || "").toLowerCase();
  return /\b(edit|blur|background|remove object|object removal|replace|change|enhance|improve|retouch|inpaint|make it|color correct|colour correct)\b/i.test(t);
}

function buildBlurredImageSvgDataUrl(imageData = {}, prompt = "") {
  const mimeType = imageData.mimeType || "image/png";
  const base64 = imageData.base64 || "";
  if (!base64) return "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <filter id="softBlur"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <rect width="1200" height="900" fill="#111827"/>
  <image href="data:${mimeType};base64,${base64}" width="1200" height="900" preserveAspectRatio="xMidYMid slice" filter="url(#softBlur)" opacity="0.96"/>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/* =========================
   QUICK INFO ROUTE
   Date / Time / Weather / Local News
========================= */

app.post("/quick-info", async (req, res) => {
  try {
    const { query = "" } = req.body || {};
    const quickInfo = await buildQuickInfoResponse(query || "Dhanbad date time weather news");
    return res.json(quickInfo);
  } catch (error) {
    console.log("QUICK INFO ERROR:", error.message);
    return res.status(500).json({ error: error.message || "Quick info failed." });
  }
});


app.post("/api/quick-info", async (req, res) => {
  try {
    const { query = "" } = req.body || {};
    const quickInfo = await buildQuickInfoResponse(query || "Dhanbad date time weather news");
    return res.json(quickInfo);
  } catch (error) {
    console.log("API QUICK INFO ERROR:", error.message);
    return res.status(500).json({ error: error.message || "Quick info failed." });
  }
});

/* =========================
   WEB SEARCH
   Serper + Wikipedia together
========================= */

app.post("/web-search", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({
        error: "Search query required",
      });
    }

    const q = query.trim();

    const serperResults = await searchSerper(q, 8);

    let wikiResults = [];

    if (shouldUseWikipedia(q)) {
      wikiResults = await searchWikipedia(q, 5);
    }

    const results = mergeUniqueResults([
      ...serperResults,
      ...wikiResults,
    ]).slice(0, 12);

    res.json({
      query: q,
      provider: shouldUseWikipedia(q)
        ? "Serper + Wikipedia"
        : "Serper",
      results,
      serperKeysLoaded: SERPER_KEYS.length,
    });
  } catch (error) {
    console.log("WEB SEARCH ERROR:", error.message);

    res.status(500).json({
      error: error.message,
    });
  }
});


/* =========================
   WEATHER HANDLER
========================= */

app.post("/weather", async (req, res) => {
  try {
    const { location } = req.body;

    if (!location || !location.trim()) {
      return res.status(400).json({
        error: "Location required",
      });
    }

    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;

    const response = await fetch(url);
    const data = await response.json();

    const current = data.current_condition?.[0];
    const area = data.nearest_area?.[0];

    if (!current) {
      return res.status(404).json({
        error: "Weather not found",
      });
    }

    res.json({
      location:
        area?.areaName?.[0]?.value ||
        location,
      country:
        area?.country?.[0]?.value || "",
      temperature: current.temp_C,
      feelsLike: current.FeelsLikeC,
      condition: current.weatherDesc?.[0]?.value,
      humidity: current.humidity,
      wind: current.windspeedKmph,
      source: "wttr.in",
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

/* =========================
   IMAGE GENERATION
   Hugging Face Inference API
========================= */

app.post("/generate-image", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Image prompt required",
      });
    }

    if (!process.env.HF_API_KEY) {
      return res.status(500).json({
        error: "HF_API_KEY missing in .env",
      });
    }

    const cleanPrompt = prompt.trim();

    const model =
      process.env.HF_IMAGE_MODEL ||
      "stabilityai/stable-diffusion-xl-base-1.0";

    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "image/png",
        },
        body: JSON.stringify({
          inputs: cleanPrompt,
          parameters: {
            negative_prompt:
              "blurry, low quality, distorted, deformed, watermark, text",
          },
          options: {
            wait_for_model: true,
          },
        }),
      }
    );

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const errorText = await response.text();
      console.log("HF IMAGE ERROR:", errorText);

      return res.status(response.status).json({
        error: errorText || "Hugging Face image generation failed",
      });
    }

    if (!contentType.startsWith("image/")) {
      const text = await response.text();
      console.log("HF NON IMAGE RESPONSE:", text);

      return res.status(500).json({
        error: "Hugging Face did not return an image. Try again later.",
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const mimeType = contentType.split(";")[0] || "image/png";
    const imageDataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

    res.json({
      success: true,
      prompt: cleanPrompt,
      imageDataUrl,
      mimeType,
      provider: "Hugging Face",
      model,
      sourceUrl: "https://huggingface.co/settings/tokens",
    });
  } catch (error) {
    console.log("IMAGE GENERATION ERROR:", error.message);

    res.status(500).json({
      error: error.message,
    });
  }
});


/* =========================
   BACKGROUND REMOVE
   remove.bg API
========================= */

app.post("/remove-background", async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData?.base64 || !imageData?.mimeType) {
      return res.status(400).json({
        error: "imageData with base64 and mimeType is required",
      });
    }

    if (!process.env.REMOVEBG_API_KEY) {
      return res.status(500).json({
        error: "REMOVEBG_API_KEY missing in .env",
      });
    }

    const imageBuffer = Buffer.from(imageData.base64, "base64");

    const formData = new FormData();

    const blob = new Blob([imageBuffer], {
      type: imageData.mimeType,
    });

    formData.append("image_file", blob, "upload.png");
    formData.append("size", "auto");
    formData.append("format", "png");

    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": process.env.REMOVEBG_API_KEY,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("REMOVEBG API ERROR:", errorText);

      return res.status(response.status).json({
        error: errorText || "remove.bg background removal failed",
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const imageDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

    res.json({
      success: true,
      imageDataUrl,
      mimeType: "image/png",
      provider: "remove.bg",
      model: "Background Removal API",
      sourceUrl: "https://www.remove.bg/api",
    });
  } catch (error) {
    console.log("REMOVE BACKGROUND ERROR:", error.message);

    res.status(500).json({
      error: error.message,
    });
  }
});


/* =========================
   IMAGE EDIT ROUTER V3
   Free-tier safe mode.
   - Local blur remains available.
   - Background removal continues through /remove-background.
   - Advanced prompt-based editing is disabled unless a real image model is configured later.
========================= */

app.post("/image-edit", async (req, res) => {
  try {
    const { prompt = "", imageData } = req.body || {};

    if (!imageData?.base64 || !imageData?.mimeType) {
      return res.status(400).json({
        success: false,
        code: "IMAGE_DATA_REQUIRED",
        error: "imageData with base64 and mimeType is required.",
      });
    }

    const cleanPrompt = String(prompt || "Edit this image.").trim();
    const lower = cleanPrompt.toLowerCase();

    if (!cleanPrompt) {
      return res.status(400).json({
        success: false,
        code: "IMAGE_EDIT_PROMPT_REQUIRED",
        error: "Edit prompt is required.",
      });
    }

    if (/blur|background blur|blur background|soft background|bg blur/i.test(lower)) {
      const imageDataUrl = buildBlurredImageSvgDataUrl(imageData, cleanPrompt);

      return res.json({
        success: true,
        imageDataUrl,
        mimeType: "image/svg+xml",
        provider: "SYNEZ Local Image Edit",
        model: "Canvas/SVG Blur",
        note: "A local blur preview was applied without using a paid image model.",
        sourceUrl: "local://synez-image-edit",
        fallbackUsed: true,
      });
    }

    if (/remove background|background remove|transparent background|cut out/i.test(lower)) {
      return res.status(422).json({
        success: false,
        code: "USE_BACKGROUND_REMOVAL_ROUTE",
        error: "Use the background-removal action for a transparent cut-out.",
        route: "/remove-background",
      });
    }

    return res.status(501).json({
      success: false,
      code: "IMAGE_MODEL_DISABLED",
      error:
        "Prompt-based image editing is currently unavailable on the active free API tier. You can still blur the image locally or use background removal.",
      availableActions: ["blur-background", "remove-background"],
    });
  } catch (error) {
    console.log("IMAGE EDIT ERROR:", error.message);
    return res.status(500).json({
      success: false,
      code: "IMAGE_EDIT_FAILED",
      error: error.message || "Image editing failed.",
    });
  }
});


/* =========================
   AGENT MODE PRO+
   Multi-search Serper + Wikipedia
========================= */

app.post("/agent-research", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({
        error: "Research query required",
      });
    }

    const q = query.trim();

    const searchQueries = [
      q,
      `${q} latest reviews`,
      `${q} price India`,
      `${q} pros cons`,
      `${q} comparison`,
    ];

    const allResults = [];

    for (const searchQuery of searchQueries) {
      const serperResults = await searchSerper(searchQuery, 5);
      const wikiResults = await searchWikipedia(searchQuery, 3);

      allResults.push(...serperResults);
      allResults.push(...wikiResults);
    }

    const results = mergeUniqueResults(allResults).slice(0, 18);

    res.json({
      query: q,
      provider: "Agent Mode Pro+ Serper + Wikipedia",
      searches: searchQueries,
      results,
      serperKeysLoaded: SERPER_KEYS.length,
    });
  } catch (error) {
    console.log("AGENT RESEARCH ERROR:", error.message);

    res.status(500).json({
      error: error.message,
    });
  }
});



/* =========================
   AUTO MODEL FALLBACK ENGINE
   Groq -> Gemini -> OpenRouter
========================= */

const openRouterFallbackModels = [
  process.env.OPENROUTER_FALLBACK_MODEL,
  "meta-llama/llama-3.1-8b-instruct:free",
  "deepseek/deepseek-r1-0528:free",
  "qwen/qwen3-coder:free",
  "google/gemma-3-27b-it:free",
].filter(Boolean);

function normalizeRequestedModel(model = "") {
  if (!model) return "llama-3.3-70b-versatile";

  if (model === "openrouter/free" || model === "openrouter-auto" || model === "openrouter/auto") {
    return "openrouter/free";
  }

  // Old/broken models are mapped to safe current options.
  if (model === "gemini-1.5-flash" || model === "gemini-1.5-flash-latest") {
    return "gemini-2.5-flash";
  }

  if (model === "meta-llama/llama-3.1-8b-instruct:free") {
    return "openrouter/free";
  }

  return model;
}

function getProviderForModel(model = "") {
  if (groqModels.includes(model)) return "Groq";
  if (geminiModels.includes(model)) return "Gemini";
  return "OpenRouter";
}

function buildFallbackPlan(selectedModel = "", hasImage = false) {
  const normalized = normalizeRequestedModel(selectedModel);
  const plan = [];
  const add = (provider, model) => {
    if (!model) return;
    const key = `${provider}:${model}`;
    if (!plan.some((item) => `${item.provider}:${item.model}` === key)) {
      plan.push({ provider, model });
    }
  };

  // Image vision should start with Gemini only, then text models if Gemini fails.
  if (hasImage) {
    add("Gemini", "gemini-2.5-flash");
  } else if (groqModels.includes(normalized)) {
    add("Groq", normalized);
  } else if (geminiModels.includes(normalized)) {
    add("Gemini", normalized);
  } else if (normalized === "openrouter/free") {
    openRouterFallbackModels.forEach((m) => add("OpenRouter", m));
  } else {
    add("OpenRouter", normalized);
  }

  // Global safe fallback order.
  add("Groq", "llama-3.3-70b-versatile");
  add("Groq", "llama-3.1-8b-instant");
  add("Gemini", "gemini-2.5-flash");
  openRouterFallbackModels.forEach((m) => add("OpenRouter", m));

  return plan;
}

function isRetryableAIError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("rate") ||
    msg.includes("quota") ||
    msg.includes("limit") ||
    msg.includes("overload") ||
    msg.includes("unavailable") ||
    msg.includes("timeout") ||
    msg.includes("timed") ||
    msg.includes("invalid") ||
    msg.includes("model") ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

async function callModelByProvider(item, safeMessages, systemPrompt, imageData = null) {
  if (item.provider === "Groq") {
    return await callGroq(item.model, safeMessages, systemPrompt);
  }

  if (item.provider === "Gemini") {
    return await callGemini(item.model, safeMessages, systemPrompt, imageData);
  }

  return await callOpenRouter(item.model, safeMessages, systemPrompt);
}

async function generateWithFallback(selectedModel, safeMessages, systemPrompt, imageData = null) {
  const plan = buildFallbackPlan(selectedModel, hasImagePayload(imageData));
  const tried = [];
  let lastError = null;

  for (const item of plan) {
    try {
      console.log(`AI TRY: ${item.provider} -> ${item.model}`);
      const reply = await callModelByProvider(item, safeMessages, systemPrompt, imageData);

      return {
        reply,
        provider: item.provider,
        model: item.model,
        fallbackUsed: tried.length > 0,
        triedModels: tried,
      };
    } catch (error) {
      const message = error?.message || "AI model failed";
      console.log(`AI FAIL: ${item.provider} -> ${item.model}: ${message}`);

      tried.push({
        provider: item.provider,
        model: item.model,
        error: message,
      });

      lastError = error;

      // If it is a hard key/config issue for every provider, still try next provider.
      if (!isRetryableAIError(error)) {
        continue;
      }
    }
  }

  throw new Error(
    `All AI models failed. Last error: ${lastError?.message || "Unknown error"}`
  );
}

function buildStreamingFallbackPlan(selectedModel = "") {
  const normalized = normalizeRequestedModel(selectedModel);
  const plan = [];
  const add = (provider, model) => {
    if (!model) return;
    const key = `${provider}:${model}`;
    if (!plan.some((item) => `${item.provider}:${item.model}` === key)) {
      plan.push({ provider, model });
    }
  };

  // Streaming currently supports Groq/OpenRouter routes. Gemini is handled by /chat.
  if (groqModels.includes(normalized)) add("Groq", normalized);
  if (normalized === "openrouter/free") openRouterFallbackModels.forEach((m) => add("OpenRouter", m));
  else if (!groqModels.includes(normalized) && !geminiModels.includes(normalized)) add("OpenRouter", normalized);

  add("Groq", "llama-3.3-70b-versatile");
  add("Groq", "llama-3.1-8b-instant");
  openRouterFallbackModels.forEach((m) => add("OpenRouter", m));

  return plan;
}

function buildStreamingRequest(item, safeMessages, systemPrompt) {
  if (item.provider === "Groq") {
    return {
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: {
        model: item.model,
        messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      },
    };
  }

  return {
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "SYNEZ AI",
    },
    body: {
      model: item.model,
      messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
    },
  };
}


/* =========================
   PHASE 4.1 WEBSITE ARCHITECT ENGINE
   Intent -> Plan -> Design System -> Focused Prompt
========================= */

function isWebsiteBuildRequest(text = "") {
  const t = String(text || "").toLowerCase();

  // Project/app/clone prompts must never fall into Website Architect.
  if (isProjectBuildRequest(t)) return false;

  const buildWords =
    /(build|create|make|generate|design|code|develop|ban[aao]|banao|bnao|bnado|website|webpage|landing page|homepage|site)/i;

  const websiteWords =
    /(website|web page|webpage|landing page|homepage|site|portfolio website|saas page|landing|frontend page)/i;

  const codeIntent =
    /(html|css|javascript|js|responsive|navbar|hero|section|cards|glassmorphism|bento|animation)/i;

  return (
    (buildWords.test(t) && websiteWords.test(t)) ||
    (websiteWords.test(t) && codeIntent.test(t)) ||
    /(build me|create me|make me|generate me).*(website|site|webpage|landing page|homepage|portfolio website)/i.test(t)
  );
}

function detectWebsiteType(text = "") {
  const t = String(text).toLowerCase();

  if (/dashboard|admin|analytics|crm|panel/.test(t)) return "AI Dashboard / Admin Panel";
  if (/ecommerce|e-commerce|shop|store|product|sneaker|nike|cart/.test(t)) return "Premium Ecommerce Landing Page";
  if (/portfolio|resume|personal|developer|student/.test(t)) return "Personal Portfolio Website";
  if (/saas|startup|ai platform|software|app landing|landing/.test(t)) return "Modern SaaS Landing Page";
  if (/blog|news|article|magazine/.test(t)) return "Editorial / Blog Website";
  if (/restaurant|food|cafe|hotel/.test(t)) return "Hospitality Website";
  if (/fitness|gym|health/.test(t)) return "Fitness / Health Website";

  return "Modern Landing Page";
}

function detectDesignStyle(text = "") {
  const t = String(text).toLowerCase();

  if (/apple|macos|ios/.test(t)) return "Apple Glass UI, soft translucent panels, premium spacing";
  if (/glass|glassmorphism/.test(t)) return "Glassmorphism with depth, blur, glowing borders";
  if (/luxury|premium|nike|fashion/.test(t)) return "Luxury editorial UI with bold typography and premium product focus";
  if (/minimal|clean/.test(t)) return "Clean minimal UI with strong hierarchy and whitespace";
  if (/neon|cyber|gaming/.test(t)) return "Dark futuristic neon UI with glowing accents";
  if (/bento/.test(t)) return "Modern bento grid UI with rich cards";

  return "Premium modern SaaS UI with bento cards, gradients, and refined motion";
}

function detectTheme(text = "") {
  const t = String(text).toLowerCase();
  if (/light|white|clean/.test(t)) return "Light theme with soft shadows";
  if (/dark|black|neon|cyber/.test(t)) return "Dark theme with glowing accents";
  return "Dark-first premium theme with optional light surfaces";
}

function buildWebsiteArchitecturePlan(userPrompt = "") {
  const type = detectWebsiteType(userPrompt);
  const style = detectDesignStyle(userPrompt);
  const theme = detectTheme(userPrompt);

  const commonSections = [
    "Floating navigation",
    "Premium hero section with strong headline and CTA",
    "Trust/metrics strip",
    "Bento feature grid",
    "Showcase/preview section",
    "Testimonials or social proof",
    "Pricing or packages when relevant",
    "FAQ",
    "Final CTA",
    "Footer",
  ];

  let sections = [...commonSections];

  if (type.includes("Dashboard")) {
    sections = [
      "Responsive app shell",
      "Sidebar navigation",
      "Top analytics bar",
      "KPI cards",
      "Chart placeholders",
      "Recent activity",
      "User table/cards",
      "Settings panel preview",
    ];
  }

  if (type.includes("Ecommerce")) {
    sections = [
      "Premium product navbar",
      "Hero product spotlight",
      "Featured product cards",
      "Category chips",
      "Product detail preview",
      "Benefits strip",
      "Testimonials",
      "Newsletter CTA",
      "Footer",
    ];
  }

  if (type.includes("Portfolio")) {
    sections = [
      "Personal navbar",
      "Hero intro",
      "Skills / tech stack",
      "Projects bento grid",
      "Experience / education",
      "Services",
      "Contact CTA",
      "Footer",
    ];
  }

  return {
    type,
    style,
    theme,
    sections,
    designSystem: {
      colors: theme.includes("Dark")
        ? "Deep navy/black base, violet/cyan gradients, white text, muted slate text"
        : "Soft white base, slate text, violet/blue accents, subtle borders",
      typography: "Large hero title, readable body text, clear hierarchy, consistent scale",
      spacing: "Generous section padding, 12/16/24/32 spacing rhythm",
      components: "Glass cards, pill buttons, bento layouts, soft shadows, rounded corners",
      motion: "Floating orbs, hover lift, reveal-on-scroll, smooth anchor scrolling",
    },
    responsivePlan:
      "Mobile-first layout, single-column cards on mobile, 2-column tablet, full bento/grid desktop.",
    seoPlan:
      "Semantic HTML, proper title/meta, accessible buttons, meaningful headings, descriptive sections.",
  };
}

function composeWebsiteArchitectPrompt(userPrompt = "") {
  const plan = buildWebsiteArchitecturePlan(userPrompt);

  return `You are now running SYNEZ Website Architect Engine.

CRITICAL RULES:
- Do NOT introduce yourself.
- Do NOT say "I am SYNEZ AI".
- Build a premium website, not a basic template.
- Output must be preview-ready.
- Use no external libraries unless the user explicitly asks.
- Do not use external CSS files, script files, image files, or icon libraries. Everything must work inside the three returned code blocks.
- Return exactly 3 fenced code blocks: html, css, javascript.
- The code must work directly in an iframe srcDoc preview.
- Avoid broken attributes. Use valid HTML.
- Use polished design comparable to v0, Emergent, Lovable style.
- Include tasteful animations and responsive CSS.
- Keep JavaScript useful but lightweight.
- Never output "HTML Copy", "CSS Copy", or malformed separated tags.

USER REQUEST:
${userPrompt}

WEBSITE PLAN:
Type: ${plan.type}
Design Style: ${plan.style}
Theme: ${plan.theme}

Sections:
${plan.sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Design System:
- Colors: ${plan.designSystem.colors}
- Typography: ${plan.designSystem.typography}
- Spacing: ${plan.designSystem.spacing}
- Components: ${plan.designSystem.components}
- Motion: ${plan.designSystem.motion}

Responsive Plan:
${plan.responsivePlan}

SEO + Accessibility Plan:
${plan.seoPlan}

OUTPUT FORMAT:
Start with this short architecture summary:

Brief Architecture:
- Type: ${plan.type}
- Sections: ${plan.sections.slice(0, 7).join(", ")}
- Design Style: ${plan.style}
- Responsive Plan: ${plan.responsivePlan}

Then output exactly:

\`\`\`html
complete valid HTML here
\`\`\`

\`\`\`css
complete CSS here
\`\`\`

\`\`\`javascript
complete JavaScript here
\`\`\`

Quality bar:
- If your output looks like a basic tutorial template, it is a failure.
- Do not use plain Arial-only basic white cards unless user asked for simple.
- Do not use fake external icon classes like Font Awesome.
- Avoid generic people names unless testimonials are requested; make them product-relevant.
- Hero must be visually impressive.
- Cards must look premium.
- Mobile must be responsive.
- CSS should be detailed enough for a polished website.
- JS should add smooth scrolling, reveal animation, or small interactions.
`;
}

function stripRepeatedIdentityIntro(reply = "") {
  return String(reply)
    .replace(/^I am SYNEZ AI\s*[—-]\s*Synergized Neural Intelligence at its Peak\.?\s*/i, "")
    .replace(/^I am SYNEZ AI\s*[—-]\s*Synergized Intelligence at its Peak\.?\s*/i, "")
    .replace(/^I was created and developed by Sameer Khan\.?\s*/i, "")
    .replace(/^I am SYNEZ AI.*?Sameer Khan\.\s*/is, "")
    .trim();
}

function ensureWebsiteOutputFormat(reply = "") {
  let text = stripRepeatedIdentityIntro(reply);

  // Strong cleanup for models that output "HTML Copy" instead of fences.
  text = text
    .replace(/\bHTML\s*Copy\s*/gi, "\n```html\n")
    .replace(/\bCSS\s*Copy\s*/gi, "\n```\n\n```css\n")
    .replace(/\bJAVASCRIPT\s*Copy\s*/gi, "\n```\n\n```javascript\n");

  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) text += "\n```";

  return text.trim();
}



function buildTaskAwareFallbackPlan(selectedModel = "", taskType = "chat", hasImage = false) {
  const normalized = normalizeRequestedModel(selectedModel);
  const plan = [];
  const add = (provider, model) => {
    if (!model) return;
    const key = `${provider}:${model}`;
    if (!plan.some((item) => `${item.provider}:${item.model}` === key)) {
      plan.push({ provider, model });
    }
  };

  if (hasImage) {
    add("Gemini", "gemini-2.5-flash");
  }

  if (taskType === "website") {
    // Best quality first. 8B should be emergency-only for premium website generation.
    add("Groq", "llama-3.3-70b-versatile");
    add("Gemini", "gemini-2.5-flash");

    // Prefer stronger coding/free OpenRouter models before 8B.
    ["qwen/qwen3-coder:free", "deepseek/deepseek-r1-0528:free", "google/gemma-3-27b-it:free"]
      .forEach((m) => add("OpenRouter", m));

    if (normalized !== "llama-3.1-8b-instant") {
      if (groqModels.includes(normalized) && normalized !== "llama-3.3-70b-versatile") {
        add("Groq", normalized);
      } else if (geminiModels.includes(normalized)) {
        add("Gemini", normalized);
      } else if (normalized === "openrouter/free") {
        openRouterFallbackModels.forEach((m) => add("OpenRouter", m));
      } else if (!groqModels.includes(normalized)) {
        add("OpenRouter", normalized);
      }
    }

    add("Groq", "llama-3.1-8b-instant");
    return plan;
  }

  return buildFallbackPlan(selectedModel, hasImage);
}

async function generateWithTaskAwareFallback(selectedModel, safeMessages, systemPrompt, imageData = null, taskType = "chat") {
  const plan = buildTaskAwareFallbackPlan(selectedModel, taskType, hasImagePayload(imageData));
  const tried = [];
  let lastError = null;

  for (const item of plan) {
    try {
      console.log(`AI TRY [${taskType}]: ${item.provider} -> ${item.model}`);
      const reply = await callModelByProvider(item, safeMessages, systemPrompt, imageData);

      return {
        reply,
        provider: item.provider,
        model: item.model,
        fallbackUsed: tried.length > 0,
        triedModels: tried,
      };
    } catch (error) {
      const message = error?.message || "AI model failed";
      console.log(`AI FAIL [${taskType}]: ${item.provider} -> ${item.model}: ${message}`);

      tried.push({
        provider: item.provider,
        model: item.model,
        error: message,
      });

      lastError = error;
      continue;
    }
  }

  throw new Error(
    `All AI models failed. Last error: ${lastError?.message || "Unknown error"}`
  );
}

function normalizeBrokenTagSpacing(code = "") {
  let out = String(code || "");

  // Fix tokenized doctype and tags caused by weak model formatting.
  out = out
    .replace(/<\s*!\s*DOCTYPE\s+html\s*>/gi, "<!DOCTYPE html>")
    .replace(/<\s*\/\s*([a-z][\w-]*)\s*>/gi, "</$1>")
    .replace(/<\s*([a-z][\w-]*)\s+/gi, "<$1 ")
    .replace(/<\s*([a-z][\w-]*)\s*>/gi, "<$1>")
    .replace(/\s+=\s+/g, "=")
    .replace(/=\s*"\s*([^"]*?)\s*"/g, '="$1"')
    .replace(/=\s*'\s*([^']*?)\s*'/g, "='$1'")
    .replace(/name\s*=\s*"viewport"/gi, 'name="viewport"')
    .replace(/content\s*=\s*"width=device-width,\s*initial-scale=1\.0"/gi, 'content="width=device-width, initial-scale=1.0"')
    .replace(/\n{3,}/g, "\n\n");

  // Aggressive cleanup for lines where each token is separated by newlines:
  out = out
    .replace(/<\n*!?\n*DOCTYPE\n+html\n*>/gi, "<!DOCTYPE html>")
    .replace(/<\n*\/\n*([a-z][\w-]*)\n*>/gi, "</$1>")
    .replace(/<\n*([a-z][\w-]*)\n+/gi, "<$1 ")
    .replace(/\n*=\n*/g, "=");

  return out.trim();
}

function normalizeCodeBlocks(reply = "") {
  let text = String(reply || "");

  text = text
    .replace(/\bHTML\s*Copy\s*/gi, "\n```html\n")
    .replace(/\bCSS\s*Copy\s*/gi, "\n```\n\n```css\n")
    .replace(/\bJAVASCRIPT\s*Copy\s*/gi, "\n```\n\n```javascript\n")
    .replace(/\bJS\s*Copy\s*/gi, "\n```\n\n```javascript\n");

  let blocks = extractCodeBlocksFromReply(text);

  if (!blocks.html || !blocks.css || !blocks.javascript) {
    const htmlMatch =
      text.match(/<!DOCTYPE[\s\S]*?<\/html>/i) ||
      text.match(/<html[\s\S]*?<\/html>/i);

    const cssStart = text.search(/```css|CSS\s*Copy|\/\*\s*Global|body\s*\{|:root\s*\{/i);
    const jsStart = text.search(/```javascript|```js|JAVASCRIPT\s*Copy|document\.|const\s+|let\s+|function\s+/i);

    if (!blocks.html && htmlMatch) blocks.html = htmlMatch[0].trim();

    if (!blocks.css && cssStart >= 0) {
      const raw = text.slice(cssStart, jsStart > cssStart ? jsStart : undefined);
      blocks.css = raw
        .replace(/```css/gi, "")
        .replace(/CSS\s*Copy/gi, "")
        .replace(/```/g, "")
        .trim();
    }

    if (!blocks.javascript && jsStart >= 0) {
      blocks.javascript = text.slice(jsStart)
        .replace(/```javascript|```js/gi, "")
        .replace(/JAVASCRIPT\s*Copy|JS\s*Copy/gi, "")
        .replace(/```/g, "")
        .trim();
    }
  }

  if (blocks.html) blocks.html = normalizeBrokenTagSpacing(blocks.html);
  if (blocks.css) blocks.css = normalizeBrokenTagSpacing(blocks.css);
  if (blocks.javascript) blocks.javascript = normalizeBrokenTagSpacing(blocks.javascript);

  if (blocks.html && blocks.css && blocks.javascript) {
    const intro = text.split(/```html|HTML\s*Copy/i)[0]
      .replace(/```[\s\S]*$/g, "")
      .trim();

    const safeIntro = intro && /Brief Architecture/i.test(intro)
      ? intro
      : "Brief Architecture:\n- Type: Modern website/application\n- Sections: Navbar, hero, content sections, CTA, footer\n- Design Style: Premium responsive UI\n- Responsive Plan: Mobile-first layout with tablet and desktop optimization.";

    return `${safeIntro}

\`\`\`html
${blocks.html}
\`\`\`

\`\`\`css
${blocks.css}
\`\`\`

\`\`\`javascript
${blocks.javascript}
\`\`\``.trim();
  }

  return text.trim();
}

function extractCodeBlocksFromReply(reply = "") {
  const blocks = {};
  const regex = /```(html|css|javascript|js)\s*([\s\S]*?)```/gi;
  let match;

  while ((match = regex.exec(reply))) {
    const lang = match[1].toLowerCase() === "js" ? "javascript" : match[1].toLowerCase();
    if (!blocks[lang]) blocks[lang] = match[2].trim();
  }

  return blocks;
}

function scoreWebsiteOutput(reply = "", plan = null) {
  const text = String(reply || "");
  const lower = text.toLowerCase();
  const blocks = extractCodeBlocksFromReply(text);

  const html = blocks.html || "";
  const css = blocks.css || "";
  const js = blocks.javascript || "";

  const issues = [];
  let score = 0;

  const hasExternalCss =
    /<link[^>]+rel=["']stylesheet["'][^>]*>/i.test(html) ||
    /href=["'][^"']*\.css["']/i.test(html) ||
    /style\.css/i.test(text);

  const hasExternalJs =
    /<script[^>]+src=["'][^"']+["'][^>]*>/i.test(html) ||
    /script\.js/i.test(text);

  const hasExternalAssets =
    /(src=["'][^"']+\.(png|jpg|jpeg|webp|gif|svg)["'])/i.test(html);

  if (/brief architecture/i.test(text)) score += 10;
  else issues.push("Missing Brief Architecture summary.");

  if (html.length > 900) score += 12;
  else issues.push("HTML is too short or missing.");

  if (css.length >= 1400) score += 22;
  else if (css.length >= 500) score += 10;
  else issues.push("CSS is missing or too short. Must return a complete CSS block, not external style.css.");

  if (js.length >= 80) score += 8;
  else issues.push("JavaScript is missing or too small. Must return a JavaScript block.");

  if (/<nav|class=["'][^"']*nav|navbar/i.test(html)) score += 7;
  else issues.push("Navbar missing.");

  if (/<footer|class=["'][^"']*footer/i.test(html)) score += 5;
  else issues.push("Footer missing.");

  if (/hero|headline|cta|call-to-action/i.test(html + css)) score += 8;
  else issues.push("Premium hero/CTA missing.");

  if (/grid|bento|card|feature|pricing|testimonial|faq/i.test(html + css)) score += 8;
  else issues.push("Important content sections/cards missing.");

  if (/@media|max-width|minmax|clamp\(/i.test(css)) score += 10;
  else issues.push("Responsive CSS missing.");

  if (/glass|backdrop-filter|blur|gradient|box-shadow|border-radius|transform|transition|animation|keyframes/i.test(css)) score += 12;
  else issues.push("Premium visual styling/motion missing.");

  if (/HTML\s*Copy|CSS\s*Copy|JAVASCRIPT\s*Copy/i.test(text)) {
    score -= 15;
    issues.push("Bad copied formatting detected.");
  }

  if (/<\s+html|<\s+body|<\s+div|<\n|nameviewport|initial=1\.0/i.test(text)) {
    score -= 12;
    issues.push("Malformed HTML detected.");
  }

  if (!blocks.html || !blocks.css || !blocks.javascript) {
    score -= 30;
    issues.push("Missing exact html/css/javascript fenced code blocks.");
  }

  if (hasExternalCss) {
    score -= 35;
    issues.push("External CSS file detected. CSS must be inside the css code block.");
  }

  if (hasExternalJs) {
    score -= 25;
    issues.push("External JS file detected. JavaScript must be inside the javascript code block.");
  }

  if (hasExternalAssets) {
    score -= 8;
    issues.push("External image assets detected. Prefer CSS visual placeholders unless user provides assets.");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    passed:
      score >= 82 &&
      blocks.html &&
      blocks.css &&
      blocks.javascript &&
      css.length >= 500 &&
      !hasExternalCss &&
      !hasExternalJs,
    issues,
    blocks,
  };
}

function buildDeterministicWebsiteFallback(userPrompt = "") {
  const plan = buildWebsiteArchitecturePlan(userPrompt);
  const isEcommerce = /ecommerce|shop|store|product|sneaker|nike|cart/i.test(userPrompt);
  const brand = isEcommerce ? "SYNEZ Store" : "SYNEZ AI";
  const title = isEcommerce ? "Premium Tech Ecommerce" : "AI SaaS Platform";
  const hero = isEcommerce
    ? "Premium tech, designed for tomorrow."
    : "Build faster with intelligent AI workflows.";
  const sub = isEcommerce
    ? "Explore premium gadgets, clean product cards, smooth interactions, and a responsive shopping experience."
    : "SYNEZ AI helps you code, research, analyze documents, compare files, and build polished websites with AI.";
  const sectionLabel = isEcommerce ? "Featured Products" : "Powerful AI Features";

  return `Brief Architecture:
- Type: ${plan.type}
- Sections: Floating Navbar, Hero, Metrics, Bento Cards, Pricing/Products, FAQ, CTA, Footer
- Design Style: ${plan.style}
- Responsive Plan: ${plan.responsivePlan}

\`\`\`html
<header class="nav">
  <a href="#" class="brand"><span>SY</span>${brand}</a>
  <nav class="links">
    <a href="#features">Features</a>
    <a href="#showcase">Showcase</a>
    <a href="#pricing">${isEcommerce ? "Products" : "Pricing"}</a>
    <a href="#faq">FAQ</a>
  </nav>
  <a href="#pricing" class="nav-cta">Get Started</a>
</header>

<main>
  <section class="hero">
    <div class="orb orb-one"></div>
    <div class="orb orb-two"></div>
    <div class="hero-copy">
      <p class="eyebrow">✨ ${title}</p>
      <h1>${hero}</h1>
      <p class="subtitle">${sub}</p>
      <div class="actions">
        <a href="#pricing" class="btn primary">${isEcommerce ? "Shop Now" : "Start Building"}</a>
        <a href="#features" class="btn secondary">Explore Features</a>
      </div>
      <div class="metrics">
        <div><strong>99.9%</strong><span>Uptime</span></div>
        <div><strong>50K+</strong><span>Tasks</span></div>
        <div><strong>24/7</strong><span>AI Assist</span></div>
      </div>
    </div>
    <div class="hero-card glass">
      <div class="card-top">
        <span></span><span></span><span></span>
      </div>
      <div class="preview-lines">
        <b></b><b></b><b></b><b></b>
      </div>
      <div class="floating-chip">AI Powered</div>
    </div>
  </section>

  <section id="features" class="section">
    <p class="section-kicker">Designed for speed</p>
    <h2>${sectionLabel}</h2>
    <div class="bento">
      <article class="glass big">
        <span class="icon">⚡</span>
        <h3>${isEcommerce ? "Fast Checkout" : "AI Coding Agent"}</h3>
        <p>${isEcommerce ? "Smooth product discovery, quick cart actions, and conversion-focused UI." : "Plan, generate, debug, and improve code with architecture-aware assistance."}</p>
      </article>
      <article class="glass">
        <span class="icon">🧠</span>
        <h3>${isEcommerce ? "Smart Picks" : "Memory v2"}</h3>
        <p>Personalized context and smarter recommendations for every workflow.</p>
      </article>
      <article class="glass">
        <span class="icon">📄</span>
        <h3>${isEcommerce ? "Product Detail" : "Docs Analyzer"}</h3>
        <p>Analyze content, compare data, and surface what matters instantly.</p>
      </article>
      <article class="glass wide">
        <span class="icon">🌐</span>
        <h3>${isEcommerce ? "Premium Storefront" : "Website Architect"}</h3>
        <p>Polished responsive layouts with bento cards, motion, and modern visual hierarchy.</p>
      </article>
    </div>
  </section>

  <section id="showcase" class="section showcase">
    <div>
      <p class="section-kicker">Live preview</p>
      <h2>Beautiful output, instantly.</h2>
      <p>Premium spacing, glass surfaces, gradients, and responsive sections built for modern users.</p>
    </div>
    <div class="showcase-panel glass">
      <div class="mini-nav"></div>
      <div class="mini-grid"><span></span><span></span><span></span><span></span></div>
    </div>
  </section>

  <section id="pricing" class="section">
    <p class="section-kicker">${isEcommerce ? "Collection" : "Simple pricing"}</p>
    <h2>${isEcommerce ? "Featured collection" : "Choose your plan"}</h2>
    <div class="pricing">
      <article class="glass price-card">
        <h3>${isEcommerce ? "Core Device" : "Starter"}</h3>
        <p class="price">${isEcommerce ? "$299" : "Free"}</p>
        <ul><li>Responsive UI</li><li>Fast experience</li><li>Premium support</li></ul>
        <button>${isEcommerce ? "Add to Cart" : "Start Free"}</button>
      </article>
      <article class="glass price-card featured">
        <h3>${isEcommerce ? "Pro Bundle" : "Pro"}</h3>
        <p class="price">${isEcommerce ? "$799" : "$19/mo"}</p>
        <ul><li>Advanced tools</li><li>Priority workflows</li><li>Best value</li></ul>
        <button>${isEcommerce ? "Buy Bundle" : "Go Pro"}</button>
      </article>
      <article class="glass price-card">
        <h3>${isEcommerce ? "Studio Kit" : "Enterprise"}</h3>
        <p class="price">${isEcommerce ? "$1299" : "Custom"}</p>
        <ul><li>Full power</li><li>Team ready</li><li>Scale safely</li></ul>
        <button>Contact</button>
      </article>
    </div>
  </section>

  <section id="faq" class="section faq">
    <p class="section-kicker">Questions</p>
    <h2>Everything you need to know</h2>
    <details open><summary>Is it responsive?</summary><p>Yes, it adapts from mobile to desktop with fluid spacing and grids.</p></details>
    <details><summary>Does it use external libraries?</summary><p>No, this demo uses only HTML, CSS, and JavaScript.</p></details>
    <details><summary>Can it be customized?</summary><p>Yes, colors, content, sections, and interactions are easy to edit.</p></details>
  </section>
</main>

<footer class="footer">
  <p>© 2026 ${brand}. Built with SYNEZ AI.</p>
  <a href="#">Privacy</a>
  <a href="#">Terms</a>
</footer>
\`\`\`

\`\`\`css
:root {
  --bg: #070914;
  --panel: rgba(255, 255, 255, .08);
  --panel-strong: rgba(255, 255, 255, .13);
  --text: #f8fafc;
  --muted: #aab3c5;
  --line: rgba(255, 255, 255, .16);
  --violet: #8b5cf6;
  --cyan: #22d3ee;
  --pink: #ec4899;
  --shadow: 0 24px 90px rgba(0,0,0,.38);
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  background:
    radial-gradient(circle at 10% 10%, rgba(139,92,246,.32), transparent 32%),
    radial-gradient(circle at 90% 20%, rgba(34,211,238,.22), transparent 30%),
    radial-gradient(circle at 50% 100%, rgba(236,72,153,.22), transparent 34%),
    var(--bg);
  color: var(--text);
  overflow-x: hidden;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(to bottom, #000, transparent 80%);
}

a { color: inherit; text-decoration: none; }

.nav {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: min(1120px, calc(100% - 32px));
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 26px;
  background: rgba(12, 16, 34, .72);
  backdrop-filter: blur(22px);
  box-shadow: var(--shadow);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 900;
  letter-spacing: -.03em;
}

.brand span {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--violet), var(--cyan));
}

.links {
  display: flex;
  align-items: center;
  gap: 18px;
  color: var(--muted);
  font-size: 14px;
}

.links a:hover { color: var(--text); }

.nav-cta,
.btn,
.price-card button {
  border: 0;
  cursor: pointer;
  border-radius: 999px;
  padding: 12px 18px;
  font-weight: 800;
  transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
}

.nav-cta,
.primary,
.price-card button {
  background: linear-gradient(135deg, var(--violet), var(--cyan));
  color: white;
  box-shadow: 0 12px 30px rgba(139,92,246,.32);
}

.secondary {
  color: white;
  border: 1px solid var(--line);
  background: rgba(255,255,255,.08);
}

.btn:hover,
.nav-cta:hover,
.price-card button:hover {
  transform: translateY(-3px);
  box-shadow: 0 20px 46px rgba(34,211,238,.22);
}

.hero {
  position: relative;
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.08fr .92fr;
  align-items: center;
  gap: 44px;
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 150px 0 80px;
}

.orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(4px);
  opacity: .75;
  animation: float 8s ease-in-out infinite;
}

.orb-one {
  width: 170px;
  height: 170px;
  left: -60px;
  top: 22%;
  background: radial-gradient(circle, rgba(139,92,246,.9), transparent 70%);
}

.orb-two {
  width: 220px;
  height: 220px;
  right: -80px;
  bottom: 14%;
  background: radial-gradient(circle, rgba(34,211,238,.65), transparent 70%);
  animation-delay: -2s;
}

.eyebrow,
.section-kicker {
  color: #67e8f9;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: .14em;
  font-size: 12px;
}

.hero h1 {
  margin: 12px 0 18px;
  max-width: 760px;
  font-size: clamp(44px, 7vw, 88px);
  line-height: .93;
  letter-spacing: -.075em;
}

.subtitle {
  max-width: 620px;
  color: var(--muted);
  font-size: clamp(17px, 2vw, 21px);
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 30px 0;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  max-width: 560px;
}

.metrics div,
.glass {
  border: 1px solid var(--line);
  background: var(--panel);
  backdrop-filter: blur(22px);
  box-shadow: var(--shadow);
}

.metrics div {
  border-radius: 22px;
  padding: 16px;
}

.metrics strong {
  display: block;
  font-size: 24px;
}

.metrics span {
  color: var(--muted);
  font-size: 13px;
}

.hero-card {
  position: relative;
  min-height: 430px;
  border-radius: 34px;
  padding: 22px;
  overflow: hidden;
  transform: perspective(900px) rotateY(-7deg) rotateX(4deg);
}

.card-top {
  display: flex;
  gap: 8px;
  margin-bottom: 44px;
}

.card-top span {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: rgba(255,255,255,.5);
}

.preview-lines {
  display: grid;
  gap: 14px;
}

.preview-lines b {
  height: 24px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255,255,255,.2), rgba(34,211,238,.45), rgba(139,92,246,.22));
}

.preview-lines b:nth-child(2) { width: 78%; }
.preview-lines b:nth-child(3) { width: 88%; }
.preview-lines b:nth-child(4) { width: 56%; }

.floating-chip {
  position: absolute;
  right: 24px;
  bottom: 24px;
  padding: 12px 16px;
  border-radius: 999px;
  background: rgba(255,255,255,.12);
  border: 1px solid var(--line);
}

.section {
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 84px 0;
}

.section h2 {
  max-width: 760px;
  margin: 10px 0 28px;
  font-size: clamp(32px, 5vw, 56px);
  line-height: 1;
  letter-spacing: -.055em;
}

.bento {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.bento article {
  min-height: 220px;
  border-radius: 30px;
  padding: 24px;
  transition: transform .28s ease, border-color .28s ease;
}

.bento article:hover {
  transform: translateY(-6px);
  border-color: rgba(34,211,238,.45);
}

.big {
  grid-column: span 2;
  grid-row: span 2;
}

.wide { grid-column: span 2; }

.icon {
  display: inline-grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 16px;
  background: rgba(255,255,255,.1);
}

.bento h3,
.price-card h3 {
  font-size: 24px;
  margin: 18px 0 10px;
}

.bento p,
.showcase p,
.faq p {
  color: var(--muted);
  line-height: 1.7;
}

.showcase {
  display: grid;
  grid-template-columns: .85fr 1.15fr;
  gap: 22px;
  align-items: center;
}

.showcase-panel {
  min-height: 360px;
  border-radius: 34px;
  padding: 22px;
}

.mini-nav {
  height: 48px;
  border-radius: 18px;
  background: rgba(255,255,255,.12);
  margin-bottom: 20px;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.mini-grid span {
  min-height: 120px;
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(139,92,246,.28), rgba(34,211,238,.14));
}

.pricing {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

.price-card {
  border-radius: 30px;
  padding: 26px;
}

.price-card.featured {
  background: linear-gradient(135deg, rgba(139,92,246,.22), rgba(34,211,238,.14));
  transform: translateY(-12px);
}

.price {
  font-size: 40px;
  font-weight: 900;
  margin: 12px 0;
}

.price-card ul {
  padding-left: 18px;
  color: var(--muted);
  line-height: 2;
}

.price-card button {
  width: 100%;
  margin-top: 18px;
}

.faq details {
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 22px;
  padding: 18px 20px;
  margin-bottom: 12px;
}

.faq summary {
  cursor: pointer;
  font-weight: 800;
}

.footer {
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto 24px;
  display: flex;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  color: var(--muted);
  border-top: 1px solid var(--line);
  padding: 26px 0;
}

.footer a:hover { color: white; }

.reveal {
  opacity: 0;
  transform: translateY(22px);
  transition: opacity .7s ease, transform .7s ease;
}

.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}

@keyframes float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-22px) scale(1.04); }
}

@media (max-width: 860px) {
  .links { display: none; }
  .hero,
  .showcase {
    grid-template-columns: 1fr;
  }
  .hero-card {
    min-height: 320px;
    transform: none;
  }
  .bento,
  .pricing,
  .metrics {
    grid-template-columns: 1fr;
  }
  .big,
  .wide {
    grid-column: span 1;
  }
  .nav {
    top: 10px;
    width: calc(100% - 20px);
  }
}

@media (max-width: 520px) {
  .nav-cta { display: none; }
  .hero { padding-top: 120px; }
  .actions { flex-direction: column; }
  .btn { text-align: center; }
}
\`\`\`

\`\`\`javascript
const revealElements = document.querySelectorAll(".section, .hero, .reveal");

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
      }
    });
  },
  { threshold: 0.15 }
);

revealElements.forEach((el) => {
  el.classList.add("reveal");
  revealObserver.observe(el);
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.querySelectorAll(".price-card button").forEach((button) => {
  button.addEventListener("click", () => {
    button.textContent = "Selected ✓";
    setTimeout(() => (button.textContent = "Get Started"), 1400);
  });
});
\`\`\``;
}
function composeWebsiteRepairPrompt(userPrompt = "", badReply = "", validation = {}, attempt = 2) {
  const plan = buildWebsiteArchitecturePlan(userPrompt);

  return `SYNEZ Website Architect Quality Repair Pass ${attempt}

Your previous website output failed quality validation.

USER REQUEST:
${userPrompt}

FAILED QUALITY ISSUES:
${(validation.issues || []).map((issue, index) => `${index + 1}. ${issue}`).join("\n")}

QUALITY REQUIREMENTS:
- Do NOT introduce yourself.
- Must include "Brief Architecture:" before code.
- Must return exactly 3 fenced code blocks: html, css, javascript.
- CSS block must be at least 1400 characters and include full styling.
- No "HTML Copy", "CSS Copy", "JAVASCRIPT Copy".
- No malformed HTML. Use normal tags like <html>, <head>, <body>.
- Do not add <link rel="stylesheet" href="styles.css"> or <script src="script.js"> because preview injects CSS/JS separately.
- Do not use external images like trust-badge.png; use CSS shapes/cards/placeholders instead.
- No external libraries.
- No external CSS/JS files. Do not use style.css, script.js, or <link rel='stylesheet'>.
- Premium website quality, not basic template.
- Strong hero, modern navbar, bento/features, CTA, footer.
- If user requested pricing/testimonials/FAQ, include them.
- CSS must be detailed and polished with responsive @media.
- Include glass/gradient/shadow/hover/motion details when fitting.
- JavaScript must add at least smooth scroll, reveal animation, or small interactions.
- The result must work in iframe srcDoc preview.

WEBSITE PLAN:
Type: ${plan.type}
Style: ${plan.style}
Theme: ${plan.theme}
Sections: ${plan.sections.join(", ")}
Responsive: ${plan.responsivePlan}
SEO: ${plan.seoPlan}

OUTPUT FORMAT:

Brief Architecture:
- Type: ${plan.type}
- Sections: ${plan.sections.slice(0, 8).join(", ")}
- Design Style: ${plan.style}
- Responsive Plan: ${plan.responsivePlan}

\`\`\`html
complete valid HTML
\`\`\`

\`\`\`css
complete polished CSS
\`\`\`

\`\`\`javascript
complete useful JavaScript
\`\`\``;
}

async function generateWebsiteWithQualityEngine({
  selectedModel,
  safeMessages,
  systemPrompt,
  userPrompt,
  imageData = null,
}) {
  let workingMessages = safeMessages;
  let bestResult = null;
  let bestValidation = null;
  const modelErrors = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await generateWithTaskAwareFallback(
        selectedModel,
        workingMessages,
        systemPrompt,
        imageData,
        "website"
      );

      const cleaned = normalizeCodeBlocks(ensureWebsiteOutputFormat(result.reply));
      const validation = scoreWebsiteOutput(cleaned);

      if (!bestValidation || validation.score > bestValidation.score) {
        bestResult = { ...result, reply: cleaned };
        bestValidation = validation;
      }

      if (validation.passed) {
        return {
          ...result,
          reply: cleaned,
          qualityScore: validation.score,
          qualityIssues: validation.issues,
          qualityRegenerated: attempt > 1,
        };
      }

      workingMessages = [
        {
          role: "user",
          content: composeWebsiteRepairPrompt(userPrompt, cleaned, validation, attempt + 1),
        },
      ];
    } catch (error) {
      const message = error?.message || "Website AI generation failed";
      console.log("WEBSITE QUALITY ENGINE FALLBACK:", message);
      modelErrors.push(message);
      break;
    }
  }

  // If AI models are rate-limited/unavailable OR return incomplete output,
  // always return the built-in premium fallback instead of throwing Chat Error.
  const fallbackReply = buildDeterministicWebsiteFallback(userPrompt);
  const fallbackValidation = scoreWebsiteOutput(fallbackReply);

  return {
    ...(bestResult || {}),
    reply: fallbackReply,
    provider: bestResult?.provider || "SYNEZ AI",
    model: bestResult?.model || "Website Fallback Engine",
    fallbackUsed: true,
    triedModels: bestResult?.triedModels || [],
    qualityScore: fallbackValidation.score,
    qualityIssues: [
      ...(bestValidation?.issues || []),
      ...modelErrors.map((m) => `AI model failure: ${m}`),
      "SYNEZ used the built-in premium website fallback because AI generation was incomplete or all models failed.",
    ],
    qualityRegenerated: true,
  };
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

  const buildVerb = /\b(build|create|generate|develop|make|banao|bnao|bnado)\b/i.test(t);
  const projectObject = /\b(app|application|platform|workspace|dashboard|portal|clone|full[-\s]?stack|complete multi[-\s]?file|react project|vite project|software project|system)\b/i.test(t);
  const websiteObject = /\b(website|webpage|landing page|homepage)\b/i.test(t);
  const negativeBuild = /do not (?:generate|build|create)|not a website generation request|not a project architecture request/i.test(t);
  if (buildVerb && projectObject && !negativeBuild && !analyzeIntent) add("architecture", 115, "New application/project generation request");
  if (buildVerb && websiteObject && !projectObject && !negativeBuild && !analyzeIntent) add("website", 105, "Standalone website generation request");

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
  if ((explicitSearch || freshInfoWords) && !buildVerb && !analyzeIntent && !quickInfoWords) add("web-search", explicitSearch ? 85 : 45, "Fresh/public-information request");

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

app.post("/orchestrate", (req, res) => {
  try {
    const { prompt = "", context = {}, explicitTask = "" } = req.body || {};
    const result = classifyMasterIntentV7(prompt, { ...context, explicitTask });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Intent classification failed." });
  }
});

/* =========================
   PHASE 5.1 PROJECT ARCHITECT CORE
   Project intent -> Architecture plan -> File tree -> Multi-file rules
========================= */

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

function isRuntimeSelfHealRequest(text = "") {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;

  const explicitEngine = /runtime self[-\s]?healing|self[-\s]?heal(?:ing)? preview|runtime repair engine/i.test(t);
  const runtimeFailure = /preview (?:has )?(?:crashed|failed|broken|blank)|blank preview|runtime (?:error|failure|crash)|vite (?:error|failed)|react (?:runtime )?error|console error|failed to compile|cannot resolve|is not defined|unexpected token/i.test(t);
  const repairIntent = /repair|heal|fix|recover|rebuild preview|reload preview|verify (?:the )?(?:repair|preview)/i.test(t);
  const projectScope = /current (?:running )?project|currently loaded project|remembered project|project files|codebase|preview|runtime/i.test(t);

  return explicitEngine || (runtimeFailure && (repairIntent || projectScope));
}

function detectTaskType(text = "", explicitTask = "") {
  const result = classifyMasterIntentV7(text, { explicitTask });
  if (result.intent === "architecture") return "project";
  if (result.intent === "website") return "website";
  if (result.intent === "runtime-self-heal") return "runtime-self-heal";
  if (result.intent === "image-generation") return "image";
  return "chat";
}

function detectProjectType(text = "") {
  const t = String(text || "").toLowerCase();

  if (/netflix|streaming|movie/.test(t)) return "Streaming Platform Clone";
  if (/spotify|music|audio/.test(t)) return "Music Streaming App";
  if (/youtube|video/.test(t)) return "Video Platform";
  if (/instagram|social|post|feed/.test(t)) return "Social Media App";
  if (/whatsapp|chat|messaging/.test(t)) return "Realtime Chat App";
  if (/ecommerce|shop|store|cart|product/.test(t)) return "Ecommerce Application";
  if (/dashboard|admin|analytics|crm/.test(t)) return "Admin Dashboard";
  if (/todo|task/.test(t)) return "Task Management App";
  if (/lms|course|education/.test(t)) return "Learning Management System";
  if (/portfolio/.test(t)) return "Portfolio Application";

  return "Modern Web Application";
}

function detectProjectStack(text = "") {
  const t = String(text || "").toLowerCase();

  if (/node|express|backend|api|full stack|database|auth|mongo|mysql/.test(t)) {
    return {
      stack: "React + Vite frontend with Node/Express backend",
      frontend: "React + Vite",
      backend: "Node.js + Express",
      database: /mongo/.test(t) ? "MongoDB" : /mysql|sql/.test(t) ? "MySQL" : "Optional database layer",
      packageManager: "npm",
    };
  }

  if (/html|css|javascript|vanilla/.test(t)) {
    return {
      stack: "Vanilla HTML/CSS/JavaScript",
      frontend: "HTML + CSS + JavaScript",
      backend: "None",
      database: "None",
      packageManager: "None",
    };
  }

  return {
    stack: "React + Vite",
    frontend: "React + Vite",
    backend: "None for v1",
    database: "Local/mock data for v1",
    packageManager: "npm",
  };
}

function getProjectFilesByType(type = "", stackInfo = {}) {
  const reactBase = [
    "package.json",
    "index.html",
    "src/main.jsx",
    "src/App.jsx",
    "src/styles.css",
    "src/data/mockData.js",
    "src/components/Navbar.jsx",
    "src/components/Hero.jsx",
    "src/components/Card.jsx",
    "src/components/Footer.jsx",
  ];

  const typeLower = type.toLowerCase();

  let files = [...reactBase];

  if (typeLower.includes("streaming")) {
    files.push(
      "src/pages/Home.jsx",
      "src/pages/Browse.jsx",
      "src/components/MovieCard.jsx",
      "src/components/CategoryRow.jsx",
      "src/components/FeaturedBanner.jsx"
    );
  } else if (typeLower.includes("music")) {
    files.push(
      "src/pages/Home.jsx",
      "src/components/PlaylistCard.jsx",
      "src/components/MusicPlayer.jsx",
      "src/components/TrackList.jsx",
      "src/components/Sidebar.jsx"
    );
  } else if (typeLower.includes("ecommerce")) {
    files.push(
      "src/pages/Home.jsx",
      "src/pages/ProductDetails.jsx",
      "src/components/ProductCard.jsx",
      "src/components/CartDrawer.jsx",
      "src/components/CategoryPills.jsx"
    );
  } else if (typeLower.includes("dashboard")) {
    files.push(
      "src/pages/Dashboard.jsx",
      "src/components/Sidebar.jsx",
      "src/components/StatCard.jsx",
      "src/components/ChartPlaceholder.jsx",
      "src/components/ActivityFeed.jsx"
    );
  } else if (typeLower.includes("chat")) {
    files.push(
      "src/pages/Chat.jsx",
      "src/components/ChatList.jsx",
      "src/components/ChatWindow.jsx",
      "src/components/MessageBubble.jsx",
      "src/components/Composer.jsx"
    );
  } else {
    files.push(
      "src/pages/Home.jsx",
      "src/components/FeatureGrid.jsx",
      "src/components/CTA.jsx"
    );
  }

  if (stackInfo.backend && stackInfo.backend.includes("Express")) {
    files.push(
      "server/package.json",
      "server/server.js",
      "server/routes/api.js",
      "server/controllers/appController.js",
      "server/middleware/errorHandler.js"
    );
  }

  files.push("README.md");

  return [...new Set(files)];
}

function buildProjectArchitecturePlan(userPrompt = "") {
  const type = detectProjectType(userPrompt);
  const stackInfo = detectProjectStack(userPrompt);
  const files = getProjectFilesByType(type, stackInfo);

  const dependencies = [];
  if (stackInfo.frontend.includes("React")) {
    dependencies.push("react", "react-dom", "vite", "@vitejs/plugin-react");
  }
  if (stackInfo.backend.includes("Express")) {
    dependencies.push("express", "cors", "dotenv");
  }

  const complexity = files.length > 18 ? "High" : files.length > 12 ? "Medium" : "Low";

  return {
    type,
    stackInfo,
    files,
    dependencies,
    complexity,
    estimatedFiles: files.length,
  };
}

function formatFileTree(files = []) {
  const tree = {};
  for (const file of files) {
    const parts = file.split("/");
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        node[part] = null;
      } else {
        node[part] = node[part] || {};
        node = node[part];
      }
    }
  }

  const render = (node, indent = "") => {
    const entries = Object.entries(node);
    return entries
      .map(([name, child], index) => {
        const isLast = index === entries.length - 1;
        const branch = isLast ? "└── " : "├── ";
        const nextIndent = indent + (isLast ? "    " : "│   ");
        if (child === null) return `${indent}${branch}${name}`;
        return `${indent}${branch}${name}/\n${render(child, nextIndent)}`;
      })
      .join("\n");
  };

  return render(tree);
}

function composeProjectArchitectPrompt(userPrompt = "") {
  const plan = buildProjectArchitecturePlan(userPrompt);

  return `You are SYNEZ AI Project Architect Engine.

CRITICAL RULES:
- Do NOT introduce yourself.
- Do NOT generate all code immediately unless the user explicitly asks "generate all files now".
- First create a professional project architecture plan.
- Behave like a senior software architect.
- Keep existing SYNEZ website mode separate. This is for complete apps/projects.
- If user asks for a clone, build an original inspired implementation, not copyrighted assets.
- Prefer React + Vite for modern frontend projects unless user asks otherwise.
- Include file tree and dependencies.
- Include next step suggestion: "Reply GENERATE to create the first project files."

USER REQUEST:
${userPrompt}

PROJECT PLAN:
Type: ${plan.type}
Stack: ${plan.stackInfo.stack}
Frontend: ${plan.stackInfo.frontend}
Backend: ${plan.stackInfo.backend}
Database: ${plan.stackInfo.database}
Complexity: ${plan.complexity}
Estimated Files: ${plan.estimatedFiles}

FILE TREE:
${formatFileTree(plan.files)}

DEPENDENCIES:
${plan.dependencies.length ? plan.dependencies.join(", ") : "No npm dependencies required for vanilla project"}

OUTPUT FORMAT:
# Project Architecture

## 1. Project Type
${plan.type}

## 2. Recommended Tech Stack
- Frontend: ${plan.stackInfo.frontend}
- Backend: ${plan.stackInfo.backend}
- Database: ${plan.stackInfo.database}
- Package Manager: ${plan.stackInfo.packageManager}

## 3. File Tree
\`\`\`txt
${formatFileTree(plan.files)}
\`\`\`

## 4. Core Features
List 6-10 features tailored to the user's request.

## 5. Component Plan
List the important components and their purpose.

## 6. Data / State Plan
Explain state, mock data, APIs, auth or storage if needed.

## 7. Build Steps
Give clear implementation steps.

## 8. Next Action
Say: "Reply GENERATE and I will create the first version of this project as multi-file code."

Do not output full code in this planning response.`;
}


function buildProjectArchitectureResponse(userPrompt = "") {
  const plan = buildProjectArchitecturePlan(userPrompt);
  const tree = formatFileTree(plan.files);

  const featureMap = {
    "Streaming Platform Clone": [
      "Hero banner with featured content",
      "Movie/show category rows",
      "Search and filter system",
      "Watchlist UI",
      "Video detail page",
      "Responsive streaming-style layout",
      "Mock authentication-ready structure",
      "Reusable content cards",
    ],
    "Music Streaming App": [
      "Sidebar navigation",
      "Playlist cards",
      "Track list UI",
      "Music player bar",
      "Search section",
      "Responsive mobile player",
      "Mock data structure",
      "Reusable audio components",
    ],
    "Ecommerce Application": [
      "Product listing",
      "Product cards",
      "Cart drawer",
      "Category filters",
      "Product detail page",
      "Checkout-ready structure",
      "Responsive layout",
      "Mock product data",
    ],
    "Admin Dashboard": [
      "Sidebar navigation",
      "Analytics cards",
      "Chart placeholders",
      "Recent activity",
      "User table",
      "Settings section",
      "Responsive admin layout",
      "Reusable stat components",
    ],
  };

  const features = featureMap[plan.type] || [
    "Modern responsive UI",
    "Reusable components",
    "Mock data layer",
    "Clean routing-ready structure",
    "Scalable folder structure",
    "Polished layout system",
    "Component-based design",
    "Easy future backend integration",
  ];

  const componentPurpose = plan.files
    .filter((file) => file.includes("components/"))
    .map((file) => {
      const name = file.split("/").pop();
      return `- ${name}: reusable UI component for the ${plan.type}.`;
    })
    .join("\n");

  return `# Project Architecture

## 1. Project Type
${plan.type}

## 2. Recommended Tech Stack
- Frontend: ${plan.stackInfo.frontend}
- Backend: ${plan.stackInfo.backend}
- Database: ${plan.stackInfo.database}
- Package Manager: ${plan.stackInfo.packageManager}
- Complexity: ${plan.complexity}
- Estimated Files: ${plan.estimatedFiles}

## 3. File Tree
\`\`\`txt
${tree}
\`\`\`

## 4. Core Features
${features.map((f) => `- ${f}`).join("\n")}

## 5. Component Plan
${componentPurpose || "- Components will be created based on the selected stack."}

## 6. Data / State Plan
- Use \`src/data/mockData.js\` for first-version mock content.
- Use component-level state for UI interactions.
- Add Context API later for global state like theme, auth, cart, player, or watchlist.
- Backend/API can be added after the frontend v1 is stable.

## 7. Dependencies
${plan.dependencies.length ? plan.dependencies.map((d) => `- ${d}`).join("\n") : "- No npm dependencies required."}

## 8. Build Steps
1. Create project folder and install dependencies.
2. Generate the file tree.
3. Build reusable layout components.
4. Add mock data.
5. Build main pages.
6. Add responsive CSS.
7. Test preview.
8. Improve UI polish and interactions.

## 9. Next Action
Reply **GENERATE** and I will create the first version of this project as multi-file code.`;
}



function isGenerateProjectRequest(text = "") {
  return /^(generate|generate files|generate project|create files|start generation|build files)$/i.test(
    String(text || "").trim()
  );
}


function isGenerateProjectRequest(text = "") {
  return /^(generate|generate files|generate project|create files|start generation|build files)$/i.test(
    String(text || "").trim()
  );
}

function buildStarterProjectFilesResponse(userPrompt = "") {
  return `# Project Files — React + Vite Todo App

=== FILE: package.json ===
\`\`\`json
{
  "name": "synez-react-todo-app",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {}
}
\`\`\`

=== FILE: index.html ===
\`\`\`html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SYNEZ Todo App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
\`\`\`

=== FILE: src/main.jsx ===
\`\`\`jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
\`\`\`

=== FILE: src/App.jsx ===
\`\`\`jsx
import Navbar from "./components/Navbar.jsx";
import TodoInput from "./components/TodoInput.jsx";
import TodoList from "./components/TodoList.jsx";
import Footer from "./components/Footer.jsx";
import { TodoProvider } from "./context/TodoContext.jsx";
import "./styles.css";

function App() {
  return (
    <TodoProvider>
      <main className="app-shell">
        <Navbar />
        <section className="hero-panel">
          <p className="eyebrow">SYNEZ React Workspace</p>
          <h1>Plan your day with a polished Todo app.</h1>
          <p className="hero-text">
            Add tasks, complete them, delete them, and keep everything saved in your browser.
          </p>
          <TodoInput />
        </section>
        <TodoList />
        <Footer />
      </main>
    </TodoProvider>
  );
}

export default App;
\`\`\`

=== FILE: src/context/TodoContext.jsx ===
\`\`\`jsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import useLocalStorage from "../hooks/useLocalStorage.js";
import defaultTodos from "../data/defaultTodos.js";

const TodoContext = createContext(null);

export function TodoProvider({ children }) {
  const [storedTodos, setStoredTodos] = useLocalStorage("synez-todos", defaultTodos);
  const [todos, setTodos] = useState(storedTodos);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setStoredTodos(todos);
  }, [todos, setStoredTodos]);

  const addTodo = (title) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    setTodos((current) => [
      {
        id: Date.now(),
        title: trimmed,
        completed: false
      },
      ...current
    ]);
  };

  const toggleTodo = (id) => {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  };

  const deleteTodo = (id) => {
    setTodos((current) => current.filter((todo) => todo.id !== id));
  };

  const visibleTodos = useMemo(() => {
    if (filter === "active") return todos.filter((todo) => !todo.completed);
    if (filter === "completed") return todos.filter((todo) => todo.completed);
    return todos;
  }, [todos, filter]);

  const value = {
    todos,
    visibleTodos,
    filter,
    setFilter,
    addTodo,
    toggleTodo,
    deleteTodo
  };

  return <TodoContext.Provider value={value}>{children}</TodoContext.Provider>;
}

export function useTodos() {
  const context = useContext(TodoContext);
  if (!context) {
    throw new Error("useTodos must be used inside TodoProvider");
  }
  return context;
}
\`\`\`

=== FILE: src/hooks/useLocalStorage.js ===
\`\`\`javascript
import { useEffect, useState } from "react";

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage errors in preview mode.
    }
  }, [key, value]);

  return [value, setValue];
}

export default useLocalStorage;
\`\`\`

=== FILE: src/data/defaultTodos.js ===
\`\`\`javascript
export default [
  {
    id: 1,
    title: "Design the SYNEZ workspace",
    completed: true
  },
  {
    id: 2,
    title: "Build React Runtime preview",
    completed: false
  },
  {
    id: 3,
    title: "Add project editor next",
    completed: false
  }
];
\`\`\`

=== FILE: src/components/Navbar.jsx ===
\`\`\`jsx
function Navbar() {
  return (
    <nav className="navbar">
      <div className="brand">
        <span>SY</span>
        <strong>SYNEZ Todo</strong>
      </div>
      <div className="nav-badge">React + Vite</div>
    </nav>
  );
}

export default Navbar;
\`\`\`

=== FILE: src/components/TodoInput.jsx ===
\`\`\`jsx
import { useRef, useState } from "react";
import { useTodos } from "../context/TodoContext.jsx";

function TodoInput() {
  const [title, setTitle] = useState("");
  const inputRef = useRef(null);
  const { addTodo } = useTodos();

  const submit = (event) => {
    event.preventDefault();
    addTodo(title);
    setTitle("");
    inputRef.current?.focus();
  };

  return (
    <form className="todo-form" onSubmit={submit}>
      <input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a new task..."
      />
      <button type="submit">Add Todo</button>
    </form>
  );
}

export default TodoInput;
\`\`\`

=== FILE: src/components/TodoList.jsx ===
\`\`\`jsx
import TodoItem from "./TodoItem.jsx";
import { useTodos } from "../context/TodoContext.jsx";

function TodoList() {
  const { visibleTodos, filter, setFilter, todos } = useTodos();

  return (
    <section className="todo-card">
      <div className="todo-header">
        <div>
          <p className="eyebrow">Tasks</p>
          <h2>{todos.length} total todos</h2>
        </div>

        <div className="filters">
          {["all", "active", "completed"].map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="todo-list">
        {visibleTodos.length ? (
          visibleTodos.map((todo) => <TodoItem key={todo.id} todo={todo} />)
        ) : (
          <p className="empty">No todos in this filter.</p>
        )}
      </div>
    </section>
  );
}

export default TodoList;
\`\`\`

=== FILE: src/components/TodoItem.jsx ===
\`\`\`jsx
import { useTodos } from "../context/TodoContext.jsx";

function TodoItem({ todo }) {
  const { toggleTodo, deleteTodo } = useTodos();

  return (
    <article className={todo.completed ? "todo-item done" : "todo-item"}>
      <button className="check" onClick={() => toggleTodo(todo.id)}>
        {todo.completed ? "✓" : ""}
      </button>
      <span>{todo.title}</span>
      <button className="delete" onClick={() => deleteTodo(todo.id)}>
        Delete
      </button>
    </article>
  );
}

export default TodoItem;
\`\`\`

=== FILE: src/components/Footer.jsx ===
\`\`\`jsx
function Footer() {
  return (
    <footer className="footer">
      Built inside SYNEZ AI Workspace · React Runtime Preview
    </footer>
  );
}

export default Footer;
\`\`\`

=== FILE: src/styles.css ===
\`\`\`css
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  background: #070816;
  color: #ffffff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at 10% 10%, rgba(124, 58, 237, .35), transparent 34%),
    radial-gradient(circle at 90% 20%, rgba(34, 211, 238, .24), transparent 30%),
    linear-gradient(135deg, #070816 0%, #0f172a 100%);
}

button,
input {
  font: inherit;
}

.app-shell {
  width: min(1100px, calc(100% - 32px));
  margin: 0 auto;
  padding: 24px 0 40px;
}

.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 26px;
  background: rgba(255,255,255,.07);
  backdrop-filter: blur(20px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand span {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 16px;
  background: linear-gradient(135deg, #8b5cf6, #22d3ee);
  font-weight: 900;
}

.brand strong {
  font-size: 22px;
}

.nav-badge {
  padding: 10px 14px;
  border-radius: 999px;
  color: #a7f3d0;
  background: rgba(16, 185, 129, .14);
  border: 1px solid rgba(16, 185, 129, .24);
}

.hero-panel,
.todo-card {
  margin-top: 24px;
  padding: 28px;
  border-radius: 32px;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 24px 80px rgba(0,0,0,.28);
}

.eyebrow {
  color: #67e8f9;
  font-weight: 900;
  letter-spacing: .16em;
  text-transform: uppercase;
}

h1 {
  max-width: 780px;
  margin: 8px 0;
  font-size: clamp(38px, 7vw, 76px);
  line-height: .95;
}

.hero-text {
  max-width: 720px;
  color: #cbd5e1;
  font-size: 19px;
  line-height: 1.7;
}

.todo-form {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.todo-form input {
  flex: 1;
  min-width: 0;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,.14);
  outline: none;
  color: #fff;
  background: rgba(15, 23, 42, .7);
}

.todo-form button,
.filters button,
.delete {
  border: 0;
  color: #fff;
  cursor: pointer;
  font-weight: 800;
  border-radius: 16px;
  transition: transform .2s ease, opacity .2s ease, background .2s ease;
}

.todo-form button {
  padding: 0 22px;
  background: linear-gradient(135deg, #8b5cf6, #22d3ee);
}

.todo-form button:hover,
.filters button:hover,
.delete:hover {
  transform: translateY(-2px);
}

.todo-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.todo-header h2 {
  margin: 0;
}

.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.filters button {
  padding: 10px 12px;
  background: rgba(255,255,255,.1);
}

.filters button.active {
  background: #7c3aed;
}

.todo-list {
  display: grid;
  gap: 12px;
  margin-top: 22px;
}

.todo-item {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(15, 23, 42, .62);
  border: 1px solid rgba(255,255,255,.1);
  animation: rise .25s ease;
}

.todo-item.done span {
  opacity: .55;
  text-decoration: line-through;
}

.check {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.18);
  background: rgba(255,255,255,.07);
  color: #86efac;
  font-weight: 900;
}

.delete {
  padding: 10px 12px;
  background: rgba(248, 113, 113, .14);
  color: #fecaca;
}

.empty {
  color: #94a3b8;
}

.footer {
  text-align: center;
  color: #94a3b8;
  margin-top: 26px;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 720px) {
  .todo-form,
  .todo-header {
    flex-direction: column;
    align-items: stretch;
  }

  .todo-form button {
    padding: 15px;
  }

  .todo-item {
    grid-template-columns: 38px 1fr;
  }

  .delete {
    grid-column: 1 / -1;
  }
}
\`\`\``;
}




/* =========================
   PHASE 6.1: PROJECT ANALYZER ENGINE
   Deterministic codebase understanding for Coding Agent v2
========================= */

function getFileCodeForAnalyzer(file) {
  if (typeof file === "string") return file;
  return String(file?.code ?? file?.content ?? "");
}

function normalizeAnalyzerFiles(projectFiles = {}) {
  const normalized = {};
  Object.entries(projectFiles || {}).forEach(([path, file]) => {
    const name = String(path || file?.name || "").replace(/\\/g, "/").trim();
    if (!name) return;
    normalized[name] = {
      name,
      lang: String(file?.lang || name.split(".").pop() || "text"),
      code: getFileCodeForAnalyzer(file),
      size: getFileCodeForAnalyzer(file).length,
    };
  });
  return normalized;
}

function getRelativeImportCandidate(fromPath = "", importPath = "") {
  if (!importPath.startsWith(".")) return null;

  const path = require("path");
  const baseDir = path.posix.dirname(String(fromPath || "").replace(/\\/g, "/"));
  const raw = path.posix.normalize(path.posix.join(baseDir, importPath));
  const candidates = [
    raw,
    `${raw}.js`,
    `${raw}.jsx`,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.css`,
    `${raw}.json`,
    `${raw}/index.js`,
    `${raw}/index.jsx`,
    `${raw}/index.ts`,
    `${raw}/index.tsx`,
  ];

  return candidates.map((item) => item.replace(/^\.\//, ""));
}

function extractImportsForAnalyzer(code = "") {
  const imports = [];
  const text = String(code || "");
  const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = importRegex.exec(text))) {
    const source = match[1] || match[2] || match[3];
    if (source) imports.push(source);
  }
  return [...new Set(imports)];
}

function extractExportsForAnalyzer(code = "") {
  const text = String(code || "");
  const exports = [];
  if (/export\s+default\s+/m.test(text) || /module\.exports\s*=/.test(text)) exports.push("default");
  [...text.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].forEach((m) => exports.push(m[1]));
  [...text.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)].forEach((m) => exports.push(m[1]));
  return [...new Set(exports)];
}

function detectProjectFramework(files = {}) {
  const names = Object.keys(files);
  const packageJson = files["package.json"]?.code || files["client/package.json"]?.code || "";
  const allCode = names.map((n) => `${n}\n${files[n].code || ""}`).join("\n").toLowerCase();

  return {
    frontend: /vite|@vitejs\/plugin-react/.test(packageJson) || /src\/main\.jsx|react-dom\/client/.test(allCode) ? "React + Vite" : /react/.test(packageJson + allCode) ? "React" : /next/.test(packageJson) ? "Next.js" : "Unknown",
    backend: /express/.test(packageJson + allCode) || names.some((n) => /server\.js|app\.js|routes\//i.test(n)) ? "Express / Node.js" : "None detected",
    auth: /firebase|signInWithPopup|onAuthStateChanged/.test(allCode) ? "Firebase Auth" : "None detected",
    database: /firestore|firebase\/firestore|collection\(|doc\(/.test(allCode) ? "Firestore" : "None detected",
    preview: /iframe|srcDoc|preview|buildReactPreviewCode|buildPreviewCode/.test(allCode) ? "Preview runtime detected" : "Not detected",
  };
}

function buildDependencyGraph(files = {}) {
  const names = Object.keys(files);
  const nameSet = new Set(names);
  const graph = {};
  const brokenImports = [];
  const externalPackages = new Set();

  names.forEach((name) => {
    const imports = extractImportsForAnalyzer(files[name]?.code || "");
    graph[name] = [];

    imports.forEach((source) => {
      if (source.startsWith(".")) {
        const candidates = getRelativeImportCandidate(name, source) || [];
        const found = candidates.find((candidate) => nameSet.has(candidate));
        if (found) graph[name].push(found);
        else brokenImports.push({ file: name, import: source, tried: candidates.slice(0, 6) });
      } else {
        const pkg = source.startsWith("@") ? source.split("/").slice(0, 2).join("/") : source.split("/")[0];
        externalPackages.add(pkg);
      }
    });
  });

  return { graph, brokenImports, externalPackages: [...externalPackages].sort() };
}

function findReverseDependencies(graph = {}) {
  const reverse = {};
  Object.entries(graph).forEach(([from, children]) => {
    (children || []).forEach((to) => {
      if (!reverse[to]) reverse[to] = [];
      reverse[to].push(from);
    });
  });
  return reverse;
}

function detectLikelyEntryFiles(files = {}) {
  const names = Object.keys(files);
  return {
    app: names.find((n) => /(^|\/)App\.(jsx|tsx|js)$/i.test(n)) || "",
    main: names.find((n) => /(^|\/)main\.(jsx|tsx|js)$/i.test(n)) || "",
    css: names.filter((n) => /\.css$/i.test(n)).slice(0, 8),
    server: names.find((n) => /(^|\/)server\.js$/i.test(n)) || names.find((n) => /(^|\/)app\.js$/i.test(n)) || "",
    packageJson: names.find((n) => /(^|\/)package\.json$/i.test(n)) || "",
  };
}

function findUnusedFiles(files = {}, graph = {}) {
  const names = Object.keys(files);
  const reverse = findReverseDependencies(graph);
  const entry = detectLikelyEntryFiles(files);
  const entrySet = new Set([entry.app, entry.main, entry.server, entry.packageJson, ...entry.css].filter(Boolean));

  return names
    .filter((name) => /\.(jsx|tsx|js|ts|css)$/i.test(name))
    .filter((name) => !entrySet.has(name))
    .filter((name) => !(reverse[name] || []).length)
    .slice(0, 30);
}

function detectCodeIssues(files = {}, graph = {}, brokenImports = []) {
  const issues = [];
  const entry = detectLikelyEntryFiles(files);

  brokenImports.forEach((item) => {
    issues.push({
      priority: "Critical",
      type: "Broken import",
      file: item.file,
      reason: `Cannot resolve import '${item.import}'.`,
      fix: "Create the missing file or correct the import path.",
    });
  });

  if (!entry.app && Object.keys(files).some((n) => /src\//.test(n))) {
    issues.push({ priority: "High", type: "Missing entry", file: "src/App.jsx", reason: "No App component file detected.", fix: "Create src/App.jsx or update the preview entry file." });
  }

  Object.entries(files).forEach(([name, file]) => {
    const code = file.code || "";
    if (/\.jsx$|\.tsx$|\.js$|\.ts$/i.test(name)) {
      if ((code.match(/useEffect\s*\(/g) || []).length && /setInterval\s*\(/.test(code) && !/clearInterval\s*\(/.test(code)) {
        issues.push({ priority: "Medium", type: "Potential memory leak", file: name, reason: "setInterval is used without a visible clearInterval cleanup.", fix: "Return a cleanup function from useEffect." });
      }
      if (/dangerouslySetInnerHTML/.test(code)) {
        issues.push({ priority: "Medium", type: "Security review", file: name, reason: "dangerouslySetInnerHTML is used.", fix: "Sanitize HTML or avoid raw HTML injection." });
      }
      if (/console\.log\(/.test(code)) {
        issues.push({ priority: "Low", type: "Debug log", file: name, reason: "console.log statements are present.", fix: "Remove or guard logs before production." });
      }
    }
  });

  return issues.slice(0, 80);
}

function buildProjectAnalysis(projectFiles = {}, diagnostics = {}) {
  const files = normalizeAnalyzerFiles(projectFiles);
  const names = Object.keys(files);
  const framework = detectProjectFramework(files);
  const { graph, brokenImports, externalPackages } = buildDependencyGraph(files);
  const reverse = findReverseDependencies(graph);
  const unusedFiles = findUnusedFiles(files, graph);
  const issues = detectCodeIssues(files, graph, brokenImports);
  const entryFiles = detectLikelyEntryFiles(files);
  const fileStats = {
    total: names.length,
    js: names.filter((n) => /\.(js|jsx|ts|tsx)$/i.test(n)).length,
    css: names.filter((n) => /\.css$/i.test(n)).length,
    json: names.filter((n) => /\.json$/i.test(n)).length,
    backend: names.filter((n) => /server|routes|api|controller/i.test(n)).length,
  };

  const healthScore = Math.max(0, Math.min(100, 100 - issues.filter((i) => i.priority === "Critical").length * 20 - issues.filter((i) => i.priority === "High").length * 12 - issues.filter((i) => i.priority === "Medium").length * 5));

  return {
    success: true,
    task: "project-analysis",
    provider: "SYNEZ Project Analyzer",
    model: "Phase 6.2 deterministic analyzer",
    summary: `${framework.frontend} frontend with ${framework.backend} backend. ${names.length} files analyzed. Health score: ${healthScore}/100.`,
    healthScore,
    project: framework,
    entryFiles,
    fileStats,
    graph,
    reverseGraph: reverse,
    externalPackages,
    brokenImports,
    unusedFiles,
    issues,
    diagnostics: {
      runtime: diagnostics?.runtime || "unknown",
      consoleLogs: Array.isArray(diagnostics?.consoleLogs) ? diagnostics.consoleLogs.slice(-20) : [],
      networkLogs: Array.isArray(diagnostics?.networkLogs) ? diagnostics.networkLogs.slice(-20) : [],
      validation: diagnostics?.projectValidation || diagnostics?.validation || null,
    },
  };
}

function wantsProjectAnalysisOnly(instruction = "") {
  const t = String(instruction || "").toLowerCase();
  return /\b(analyze|analyse|inspect|review|health report|dependency graph|readiness|can this project build|understand every file|do not edit|do not modify)\b/.test(t) && !/\b(automatically fix|auto fix|fix every|edit required|modify files|apply fix)\b/.test(t);
}

function formatProjectAnalysisMarkdown(analysis = {}) {
  const issues = analysis.issues || [];
  const broken = analysis.brokenImports || [];
  const unused = analysis.unusedFiles || [];
  const graph = analysis.graph || {};
  const graphRows = Object.entries(graph).slice(0, 20).map(([from, deps]) => `- **${from}** → ${(deps || []).length ? deps.join(", ") : "no local imports"}`);

  return `### 🧠 SYNEZ Project Analyzer — Phase 6.2

${analysis.summary || "Project analysis completed."}

**Project Type**
- Frontend: ${analysis.project?.frontend || "Unknown"}
- Backend: ${analysis.project?.backend || "Unknown"}
- Auth: ${analysis.project?.auth || "Unknown"}
- Database: ${analysis.project?.database || "Unknown"}
- Preview: ${analysis.project?.preview || "Unknown"}

**Files**
- Total: ${analysis.fileStats?.total ?? 0}
- JS/JSX/TS/TSX: ${analysis.fileStats?.js ?? 0}
- CSS: ${analysis.fileStats?.css ?? 0}
- JSON: ${analysis.fileStats?.json ?? 0}

**Entry Files**
- App: ${analysis.entryFiles?.app || "Not detected"}
- Main: ${analysis.entryFiles?.main || "Not detected"}
- Server: ${analysis.entryFiles?.server || "Not detected"}

**Dependency Graph**
${graphRows.length ? graphRows.join("\n") : "- No dependency graph available."}

**Issues Found**
${issues.length ? issues.map((item) => `- **${item.priority}** — ${item.type} in \`${item.file}\`: ${item.reason}`).join("\n") : "- No critical project structure issues detected."}

**Broken Imports**
${broken.length ? broken.map((item) => `- \`${item.file}\` imports \`${item.import}\``).join("\n") : "- None detected."}

**Potentially Unused Files**
${unused.length ? unused.map((file) => `- ${file}`).join("\n") : "- None detected."}

No files were modified.`;
}

/* =========================
   PHASE 5: AI CODING AGENT V2
   Multi-file project understanding + patch generation
========================= */

function normalizeProjectFilesForAgent(projectFiles = {}) {
  const normalized = {};
  Object.entries(projectFiles || {}).forEach(([path, file]) => {
    const name = String(path || file?.name || "").trim();
    if (!name) return;
    const code = String(file?.code ?? file?.content ?? file ?? "");
    const lang = String(file?.lang || name.split(".").pop() || "text");
    normalized[name] = {
      name,
      lang,
      code: code.length > 45000 ? code.slice(0, 45000) + "\n\n/* [TRIMMED FOR AGENT CONTEXT] */" : code,
    };
  });
  return normalized;
}

function buildProjectContextForAgent(projectFiles = {}) {
  const files = normalizeProjectFilesForAgent(projectFiles);
  const entries = Object.entries(files);

  if (!entries.length) return "No project files were provided.";

  return entries
    .slice(0, 80)
    .map(([name, file]) => {
      return `--- FILE: ${name} ---\n\`\`\`${file.lang || "text"}\n${file.code || ""}\n\`\`\``;
    })
    .join("\n\n");
}



function readTextFileIfExists(filePath = "") {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function buildSelfProjectFilesFallback() {
  const candidates = [
    { name: "client/src/App.jsx", paths: [path.join(__dirname, "../client/src/App.jsx"), path.join(__dirname, "../src/App.jsx"), path.join(process.cwd(), "../client/src/App.jsx"), path.join(process.cwd(), "../src/App.jsx")] },
    { name: "client/src/App.css", paths: [path.join(__dirname, "../client/src/App.css"), path.join(__dirname, "../src/App.css"), path.join(process.cwd(), "../client/src/App.css"), path.join(process.cwd(), "../src/App.css")] },
    { name: "server/server.js", paths: [path.join(__dirname, "server.js"), path.join(process.cwd(), "server.js")] },
    { name: "client/package.json", paths: [path.join(__dirname, "../client/package.json"), path.join(__dirname, "../package.json"), path.join(process.cwd(), "../client/package.json"), path.join(process.cwd(), "../package.json")] },
    { name: "server/package.json", paths: [path.join(__dirname, "package.json"), path.join(process.cwd(), "package.json")] },
    { name: "client/src/firebase.js", paths: [path.join(__dirname, "../client/src/firebase.js"), path.join(__dirname, "../src/firebase.js"), path.join(process.cwd(), "../client/src/firebase.js"), path.join(process.cwd(), "../src/firebase.js")] },
    { name: "client/src/main.jsx", paths: [path.join(__dirname, "../client/src/main.jsx"), path.join(__dirname, "../src/main.jsx"), path.join(process.cwd(), "../client/src/main.jsx"), path.join(process.cwd(), "../src/main.jsx")] },
  ];

  const files = {};

  candidates.forEach((item) => {
    const foundPath = item.paths.find((candidate) => fs.existsSync(candidate));
    if (!foundPath) return;

    const code = readTextFileIfExists(foundPath);
    if (!code.trim()) return;

    const ext = item.name.split(".").pop() || "text";
    files[item.name] = {
      name: item.name,
      lang: ext === "jsx" ? "jsx" : ext === "css" ? "css" : ext === "json" ? "json" : ext === "js" ? "javascript" : ext,
      code,
      sourcePath: foundPath,
    };
  });

  return files;
}

function ensureProjectFilesForAgent(projectFiles = {}) {
  const normalized = normalizeProjectFilesForAgent(projectFiles);
  if (Object.keys(normalized).length) return normalized;
  return normalizeProjectFilesForAgent(buildSelfProjectFilesFallback());
}

function buildCodingAgentPrompt({ instruction = "", projectFiles = {}, diagnostics = {} }) {
  const fileNames = Object.keys(projectFiles || {});
  const diagnosticsText = JSON.stringify(diagnostics || {}, null, 2).slice(0, 12000);
  const context = buildProjectContextForAgent(projectFiles);

  return `You are SYNEZ AI Coding Agent v2.

Your job:
- Understand the uploaded/current project files.
- Find bugs and runtime issues.
- Edit multiple files when required.
- Refactor components safely.
- Create missing files when required.
- Preserve existing UI unless the user explicitly asks to change UI.
- Return full replacement code only for changed or newly created files.
- Explain changes briefly.

Critical rules:
1. Do not return markdown outside the JSON.
2. Do not include code fences inside JSON string values.
3. Do not omit imports needed by edited files.
4. If you change a React component, return the full file code.
5. If a file is unchanged, do not include it in files.
6. Keep CSS/UI unchanged unless instruction requires styling.
7. Never invent external packages unless absolutely needed. Prefer plain React/CSS.
8. If package.json must change, include the full package.json.
9. If there is not enough information, return an explanation and an empty files object.

User instruction:
${instruction}

Project files detected:
${fileNames.join("\n") || "No files"}

Runtime diagnostics / preview logs:
${diagnosticsText}

Project context:
${context}

Return ONLY valid JSON in this exact shape:
{
  "summary": "short explanation",
  "changes": ["change 1", "change 2"],
  "createdFiles": ["path/file.ext"],
  "updatedFiles": ["path/file.ext"],
  "notes": ["note 1"],
  "files": {
    "src/App.jsx": "FULL FILE CODE HERE",
    "src/styles.css": "FULL FILE CODE HERE"
  }
}`;
}

function extractAgentJson(text = "") {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Coding Agent returned an empty response.");

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = cleaned.slice(first, last + 1);
    return JSON.parse(slice);
  }

  throw new Error("Coding Agent did not return valid JSON.");
}

function buildCodingAgentFallbackResponse(instruction = "") {
  return {
    summary: "I could not safely produce a file patch for this request.",
    changes: [],
    createdFiles: [],
    updatedFiles: [],
    notes: [
      "Try asking with a more specific target file or paste the exact runtime error.",
      `Original instruction: ${String(instruction || "").slice(0, 280)}`,
    ],
    files: {},
  };
}


app.post("/coding-agent/analyze", async (req, res) => {
  try {
    const { projectFiles = {}, diagnostics = {} } = req.body || {};
    const filesForAnalysis = ensureProjectFilesForAgent(projectFiles);
    const analysis = buildProjectAnalysis(filesForAnalysis, diagnostics);
    return res.json({
      ...analysis,
      reply: formatProjectAnalysisMarkdown(analysis),
      files: {},
      changes: [],
      createdFiles: [],
      updatedFiles: [],
      notes: ["Analysis-only mode: no files were modified."],
    });
  } catch (error) {
    console.error("Project Analyzer Error:", error.message);
    return res.status(500).json({ success: false, error: error.message || "Project analysis failed." });
  }
});

app.post("/api/coding-agent/analyze", async (req, res) => {
  try {
    const { projectFiles = {}, diagnostics = {} } = req.body || {};
    const filesForAnalysis = ensureProjectFilesForAgent(projectFiles);
    const analysis = buildProjectAnalysis(filesForAnalysis, diagnostics);
    return res.json({
      ...analysis,
      reply: formatProjectAnalysisMarkdown(analysis),
      files: {},
      changes: [],
      createdFiles: [],
      updatedFiles: [],
      notes: ["Analysis-only mode: no files were modified."],
    });
  } catch (error) {
    console.error("API Project Analyzer Error:", error.message);
    return res.status(500).json({ success: false, error: error.message || "Project analysis failed." });
  }
});

app.post("/coding-agent", async (req, res) => {
  try {
    const {
      instruction = "",
      projectFiles = {},
      diagnostics = {},
      model = "llama-3.3-70b-versatile",
      userName = "User",
      userEmail = "guest",
    } = req.body || {};

    if (!String(instruction || "").trim()) {
      return res.status(400).json({ error: "instruction is required." });
    }

    const normalizedProject = ensureProjectFilesForAgent(projectFiles);
    if (!Object.keys(normalizedProject).length) {
      return res.status(400).json({ error: "No project files were found. Upload files or run the backend from the correct project folder." });
    }

    if (wantsProjectAnalysisOnly(instruction)) {
      const analysis = buildProjectAnalysis(normalizedProject, diagnostics);
      return res.json({
        ...analysis,
        reply: formatProjectAnalysisMarkdown(analysis),
        files: {},
        changes: [],
        createdFiles: [],
        updatedFiles: [],
        notes: ["Analysis-only mode: no files were modified."],
      });
    }

    const selectedModel = normalizeRequestedModel(model || "llama-3.3-70b-versatile");
    const systemPrompt = createSystemPrompt(userName || "User", userEmail || "guest");
    const agentPrompt = buildCodingAgentPrompt({
      instruction,
      projectFiles: normalizedProject,
      diagnostics,
    });

    const result = await generateWithFallback(
      selectedModel,
      [{ role: "user", content: agentPrompt }],
      `${systemPrompt}\n\nYou are now operating in strict JSON patch mode for SYNEZ Coding Agent v2.`,
      null
    );

    let patch;
    try {
      patch = extractAgentJson(result.reply);
    } catch (parseError) {
      console.error("Coding Agent JSON parse error:", parseError.message);
      patch = buildCodingAgentFallbackResponse(instruction);
      patch.rawReply = String(result.reply || "").slice(0, 4000);
    }

    const requestedMutation = /\b(automatically fix|auto fix|apply (?:the )?fix|fix every|fix all|refactor this project|implement|create missing|update this project|modify this project)\b/i.test(instruction);
    const analysisOnlyRequest = wantsProjectAnalysisOnly(instruction) || /\b(wait for confirmation|do not modify|do not edit|report only|suggest only)\b/i.test(instruction);

    // Never return/apply model-generated file patches for review-only requests.
    if (analysisOnlyRequest && !requestedMutation) {
      const analysis = buildProjectAnalysis(normalizedProject, diagnostics);
      return res.json({
        ...analysis,
        reply: formatProjectAnalysisMarkdown(analysis),
        files: {},
        changes: [],
        createdFiles: [],
        updatedFiles: [],
        notes: ["Analysis-only mode: no files were modified."],
      });
    }

    const files = patch.files && typeof patch.files === "object" ? patch.files : {};
    const safeFiles = {};
    Object.entries(files).forEach(([name, code]) => {
      const cleanName = String(name || "").trim();
      if (!cleanName || typeof code !== "string") return;
      safeFiles[cleanName] = code;
    });

    const changedCount = Object.keys(safeFiles).length;
    const sweepingPatch = changedCount > 8;
    const changesPackageJson = Object.keys(safeFiles).some((name) => /(^|\/)package\.json$/i.test(name));
    if (sweepingPatch || (changesPackageJson && !/\b(dependenc|package\.json|install package|add package)\b/i.test(instruction))) {
      return res.json({
        success: true,
        summary: "Unsafe broad patch was blocked. No files were modified.",
        changes: [],
        createdFiles: [],
        updatedFiles: [],
        notes: [
          sweepingPatch ? `The model attempted to modify ${changedCount} files at once.` : "The model attempted an unrequested package.json change.",
          "Ask for a smaller targeted refactor or approve a specific group of files.",
        ],
        files: {},
        provider: result.fallbackUsed ? `${result.provider} Auto Fallback` : result.provider,
        model: result.model,
      });
    }

    return res.json({
      success: true,
      summary: patch.summary || "Coding Agent patch generated.",
      changes: Array.isArray(patch.changes) ? patch.changes : [],
      createdFiles: Array.isArray(patch.createdFiles) ? patch.createdFiles : [],
      updatedFiles: Array.isArray(patch.updatedFiles) ? patch.updatedFiles : Object.keys(safeFiles),
      notes: Array.isArray(patch.notes) ? patch.notes : [],
      files: safeFiles,
      rawReply: patch.rawReply || undefined,
      provider: result.fallbackUsed ? `${result.provider} Auto Fallback` : result.provider,
      model: result.model,
    });
  } catch (error) {
    console.error("Coding Agent Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Coding Agent failed.",
      ...buildCodingAgentFallbackResponse(req.body?.instruction || ""),
    });
  }
});

app.post("/runtime-self-heal", async (req, res) => {
  try {
    const {
      instruction: userInstruction = "",
      runtimeError = null,
      projectFiles = {},
      diagnostics = {},
      model = "llama-3.3-70b-versatile",
      userName = "User",
      userEmail = "guest",
    } = req.body || {};

    const consoleLogs = Array.isArray(diagnostics?.consoleLogs) ? diagnostics.consoleLogs : [];
    const networkLogs = Array.isArray(diagnostics?.networkLogs) ? diagnostics.networkLogs : [];
    const candidateMessages = [
      runtimeError?.message,
      diagnostics?.error,
      ...consoleLogs.filter((item) => item?.type === "error").map((item) => item?.message),
      ...networkLogs.filter((item) => item?.ok === false || Number(item?.status) >= 400).map((item) => `${item?.method || "GET"} ${item?.url || ""} ${item?.status || "failed"}`),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    const evidencePattern = /(referenceerror|typeerror|syntaxerror|rangeerror|uncaught|cannot\s+(?:find|resolve|read)|module\s+not\s+found|failed\s+to\s+resolve|is\s+not\s+defined|unexpected\s+token|unterminated|invalid\s+jsx|maximum\s+update\s+depth|too\s+many\s+re-renders|failed\s+to\s+fetch|networkerror|status\s*(?:4\d\d|5\d\d)|\b(?:404|500|502|503|504)\b)/i;
    const errorMessage = candidateMessages.find((message) => evidencePattern.test(message)) || "";

    if (!errorMessage) {
      return res.json({
        success: true,
        summary: "No runtime evidence found.",
        evidence: null,
        changes: [],
        createdFiles: [],
        updatedFiles: [],
        notes: [
          "No browser-console, React, Vite, build, network, or runtime error matched the evidence rules.",
          "No files were modified and no snapshot was required.",
        ],
        files: {},
        verification: { status: "NOT_REQUIRED", reason: "No confirmed error evidence." },
        rollbackStatus: "Not required",
        provider: "SYNEZ Evidence Lock",
        model: "Phase 6.8.2 deterministic gate",
        attemptPolicy: { maxAttemptsPerError: 2, maxChangedFiles: 4 },
      });
    }

    const normalizedProject = ensureProjectFilesForAgent(projectFiles);
    if (!Object.keys(normalizedProject).length) {
      return res.status(400).json({ success: false, error: "No project files were available for self-healing." });
    }

    const fileMatch = errorMessage.match(/(?:https?:\/\/[^\s)]+\/)?((?:src|client\/src|server)\/[\w./-]+\.(?:jsx?|tsx?|css|json))(?::(\d+))?(?::(\d+))?/i);
    const evidence = {
      message: errorMessage.slice(0, 1200),
      file: fileMatch?.[1] || null,
      line: fileMatch?.[2] ? Number(fileMatch[2]) : null,
      column: fileMatch?.[3] ? Number(fileMatch[3]) : null,
      source: runtimeError?.message ? "runtime" : consoleLogs.length ? "console" : "network/build",
    };

    const instruction = `${String(userInstruction || "").trim() || "Repair the confirmed preview/runtime failure."}

CONFIRMED RUNTIME EVIDENCE (the only allowed basis for edits):
${errorMessage}

Strict rules:
- If the evidence does not identify a defensible code change, return zero files.
- Change only files directly responsible for this exact error.
- Preserve UI, animations, responsiveness, and existing functionality.
- Do not invent missing components, imports, variables, dependencies, line numbers, or successful verification.
- Do not refactor unrelated code.
- package.json is locked unless the evidence explicitly contains a module/package resolution failure naming that dependency.
- Return full replacement code only for changed files.
- Maximum 4 changed files.
- In summary and changes, quote the exact evidence that each patch resolves.`;

    const selectedModel = normalizeRequestedModel(model || "llama-3.3-70b-versatile");
    const systemPrompt = createSystemPrompt(userName || "User", userEmail || "guest");
    const agentPrompt = buildCodingAgentPrompt({
      instruction,
      projectFiles: normalizedProject,
      diagnostics: { ...diagnostics, runtimeError, confirmedEvidence: evidence },
    });

    const result = await generateWithFallback(
      selectedModel,
      [{ role: "user", content: agentPrompt }],
      `${systemPrompt}\n\nYou are operating in evidence-locked runtime-repair JSON mode. Never claim a repair or verification without evidence.`,
      null
    );

    let patch;
    try {
      patch = extractAgentJson(result.reply);
    } catch (error) {
      return res.json({
        success: true,
        summary: "Confirmed runtime evidence was found, but no safe machine-readable patch was produced.",
        evidence,
        changes: [],
        files: {},
        notes: [error.message],
        verification: { status: "NOT_RUN", reason: "No patch applied." },
        rollbackStatus: "Not required",
        provider: result.provider,
        model: result.model,
      });
    }

    const rawFiles = patch.files && typeof patch.files === "object" ? patch.files : {};
    const safeFiles = {};
    const packageEvidence = /(?:cannot find package|cannot find module|module not found|failed to resolve import)\s*["'`]?([^\s"'`]+)/i.test(errorMessage);
    Object.entries(rawFiles).slice(0, 4).forEach(([name, code]) => {
      const cleanName = String(name || "").trim();
      if (!cleanName || typeof code !== "string") return;
      if (/(^|\/)package\.json$/i.test(cleanName) && !packageEvidence) return;
      if (evidence.file && cleanName !== evidence.file && !errorMessage.includes(cleanName)) return;
      if (!normalizedProject[cleanName] && !/cannot find|module not found|failed to resolve/i.test(errorMessage)) return;
      safeFiles[cleanName] = code;
    });

    const changedNames = Object.keys(safeFiles);
    const rawChanges = Array.isArray(patch.changes) ? patch.changes.map(String) : [];
    const evidenceWords = errorMessage.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    const groundedChanges = rawChanges.filter((change) => {
      const c = change.toLowerCase();
      return evidenceWords.some((word) => c.includes(word)) || changedNames.some((name) => c.includes(name.toLowerCase()));
    });

    return res.json({
      success: true,
      summary: changedNames.length
        ? "A minimal evidence-based runtime patch was generated. Verification must occur after the preview reload."
        : "Confirmed runtime evidence was found, but no safe evidence-based patch was produced.",
      evidence,
      changes: groundedChanges,
      createdFiles: Array.isArray(patch.createdFiles) ? patch.createdFiles.filter((name) => changedNames.includes(name)) : [],
      updatedFiles: changedNames,
      notes: [
        ...(Array.isArray(patch.notes) ? patch.notes : []),
        changedNames.length ? "The frontend must reload the preview and confirm that the same error signature disappears." : "No files were modified.",
      ],
      files: safeFiles,
      provider: result.fallbackUsed ? `${result.provider} Auto Fallback` : result.provider,
      model: result.model,
      verification: {
        status: changedNames.length ? "PENDING_PREVIEW_RELOAD" : "NOT_RUN",
        errorSignature: errorMessage.slice(0, 500),
      },
      rollbackStatus: "Not required unless post-reload verification fails",
      attemptPolicy: { maxAttemptsPerError: 2, maxChangedFiles: 4 },
    });
  } catch (error) {
    console.error("Runtime Self-Heal Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Runtime self-heal failed.",
      files: {},
    });
  }
});

/* =========================
   NORMAL CHAT
========================= */

app.post("/chat", async (req, res) => {
  try {
    const { messages, model, userName, userEmail, imageData, taskType } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        reply: "Invalid messages format.",
        provider: "Error",
        model: "Error",
      });
    }

    const selectedModel = normalizeRequestedModel(model || "llama-3.3-70b-versatile");
    const safeMessages = cleanMessages(messages);
    const lastUserMessage = getLastUserMessage(safeMessages);
    const orchestration = classifyMasterIntentV7(lastUserMessage, {
      explicitTask: taskType,
      imageData,
      hasImages: hasImagePayload(imageData),
    });

    // Master Orchestrator v7: only the winning live-info engine may execute.
    if (orchestration.intent === "quick-info") {
      const quickInfo = await buildQuickInfoResponse(lastUserMessage);
      return res.json(quickInfo);
    }

    if (isGenerateProjectRequest(lastUserMessage)) {
      return res.json({
        reply: buildStarterProjectFilesResponse(lastUserMessage),
        provider: "SYNEZ AI",
        model: "Deterministic Project Generator",
        task: "project-generate",
        orchestrator: orchestration,
      });
    }

    const resolvedTask = orchestration.intent === "architecture"
      ? "project"
      : orchestration.intent === "website"
      ? "website"
      : orchestration.intent === "runtime-self-heal"
      ? "runtime-self-heal"
      : detectTaskType(lastUserMessage, taskType);
    const isProjectMode = resolvedTask === "project";
    const isWebsiteMode = resolvedTask === "website";
    const isRuntimeMode = resolvedTask === "runtime-self-heal";
    console.log("TASK:", resolvedTask, "| ROUTE: /chat | MODEL:", selectedModel);

    if (isRuntimeMode) {
      return res.json({
        reply: "Runtime Self-Healing mode selected. Open the current project preview so SYNEZ can collect its console/runtime evidence and apply a minimal repair.",
        provider: "SYNEZ Runtime Router",
        model: "Phase 6.8.1 Route Lock",
        task: "runtime-self-heal",
        orchestrator: orchestration,
      });
    }

    // Project architecture is local and must happen before any AI call or website fallback.
    if (isProjectMode) {
      return res.json({
        reply: buildProjectArchitectureResponse(lastUserMessage),
        provider: "SYNEZ AI",
        model: "Project Architect Engine",
        task: "project",
        orchestrator: orchestration,
      });
    }

    const systemPrompt = createSystemPrompt(userName || "User", userEmail || "guest");

    const modelMessages = isWebsiteMode
      ? [
          ...safeMessages.filter((m) => m.role !== "system").slice(0, -1),
          {
            role: "user",
            content: composeWebsiteArchitectPrompt(lastUserMessage),
          },
        ]
      : safeMessages;

    if (isImageGenerationRequest(lastUserMessage)) {
      return res.json({
        reply:
          "Image generation is available. Please use a prompt like: generate image red sports car. If it still does not work, check HF_API_KEY in backend .env.",
        provider: "SYNEZ AI",
        model: "Image Generation Help",
      });
    }

    const result = isWebsiteMode
      ? await generateWebsiteWithQualityEngine({
          selectedModel,
          safeMessages: modelMessages,
          systemPrompt,
          userPrompt: lastUserMessage,
          imageData: hasImagePayload(imageData) ? imageData : null,
        })
      : await generateWithFallback(
          selectedModel,
          modelMessages,
          systemPrompt,
          hasImagePayload(imageData) ? imageData : null
        );

    const finalReply = isWebsiteMode
      ? normalizeCodeBlocks(ensureWebsiteOutputFormat(result.reply))
      : stripRepeatedIdentityIntro(result.reply);

    res.json({
      reply: finalReply,
      qualityScore: result.qualityScore,
      qualityRegenerated: result.qualityRegenerated,
      qualityIssues: result.qualityIssues,
      provider: result.fallbackUsed
        ? `${result.provider} Auto Fallback`
        : result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      triedModels: result.triedModels,
    });
  } catch (error) {
    console.error("Chat Error:", error.message);

    res.status(500).json({
      reply: `❌ ${error.message}`,
      provider: "Error",
      model: "Error",
    });
  }
});

/* =========================
   STREAMING CHAT
========================= */

app.post("/chat-stream", async (req, res) => {
  try {
    const { messages, model, userName, userEmail, taskType } = req.body;

    if (!Array.isArray(messages)) {
      res.status(400).write("Invalid messages format.");
      return res.end();
    }

    const selectedModel = normalizeRequestedModel(model || "llama-3.3-70b-versatile");
    const safeMessages = cleanMessages(messages);
    const lastUserMessage = getLastUserMessage(safeMessages);

    if (isTimeDateWeatherNewsRequest(lastUserMessage)) {
      const quickInfo = await buildQuickInfoResponse(lastUserMessage);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.write(quickInfo.reply || "No live info found.");
      return res.end();
    }

    const isWebsiteMode = taskType === "website" || isWebsiteBuildRequest(lastUserMessage);
    const systemPrompt = createSystemPrompt(userName || "User", userEmail || "guest");

    const modelMessages = isWebsiteMode
      ? [
          ...safeMessages.filter((m) => m.role !== "system").slice(0, -1),
          {
            role: "user",
            content: composeWebsiteArchitectPrompt(lastUserMessage),
          },
        ]
      : safeMessages;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (isImageGenerationRequest(lastUserMessage)) {
      res.write(
        "Image generation is available. Please use a prompt like: generate image red sports car."
      );
      return res.end();
    }

    // Website generation must not stream, because we need validation + repair + formatting cleanup.
    // If frontend accidentally calls /chat-stream for website prompts, handle it safely here.
    if (isWebsiteMode) {
      try {
        const result = await generateWebsiteWithQualityEngine({
          selectedModel,
          safeMessages: modelMessages,
          systemPrompt,
          userPrompt: lastUserMessage,
          imageData: null,
        });

        res.write(normalizeCodeBlocks(ensureWebsiteOutputFormat(result.reply)));
        return res.end();
      } catch (error) {
        res.write("❌ Website Architect failed: " + error.message);
        return res.end();
      }
    }

    const plan = buildStreamingFallbackPlan(selectedModel);
    let response = null;
    let selectedItem = null;
    let lastErrorText = "";
    let fallbackCount = 0;

    for (const item of plan) {
      try {
        const request = buildStreamingRequest(item, modelMessages, systemPrompt);

        const trialResponse = await fetch(request.apiUrl, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(request.body),
        });

        if (!trialResponse.ok || !trialResponse.body) {
          lastErrorText = await trialResponse.text();
          console.log(`STREAM AI FAIL: ${item.provider} -> ${item.model}:`, lastErrorText);
          fallbackCount += 1;
          continue;
        }

        response = trialResponse;
        selectedItem = item;
        break;
      } catch (error) {
        lastErrorText = error.message;
        console.log(`STREAM AI FAIL: ${item.provider} -> ${item.model}:`, error.message);
        fallbackCount += 1;
      }
    }

    if (!response || !selectedItem) {
      res.write("❌ All streaming models failed. " + lastErrorText);
      return res.end();
    }

    if (fallbackCount > 0) {
      res.write(`⚡ Auto switched to ${selectedItem.provider} ${selectedItem.model}\n\n`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const data = line.replace(/^data:\s*/, "").trim();

        if (data === "[DONE]") return res.end();

        try {
          const parsed = JSON.parse(data);
          const token =
            parsed.choices?.[0]?.delta?.content ||
            parsed.choices?.[0]?.message?.content ||
            "";

          if (token) res.write(token);
        } catch {}
      }
    }

    res.end();
  } catch (error) {
    console.log("Streaming Error:", error.message);
    res.write("❌ Streaming error: " + error.message);
    res.end();
  }
});

/* =========================
   ELEVENLABS TTS
========================= */

app.post("/tts", async (req, res) => {
  try {
    const { text } = req.body;

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "ELEVENLABS_API_KEY missing in .env",
      });
    }

    if (!process.env.ELEVENLABS_VOICE_ID) {
      return res.status(500).json({
        error: "ELEVENLABS_VOICE_ID missing in .env",
      });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({
        error: "Text is required",
      });
    }

    const cleanText = text
      .replace(/```[\s\S]*?```/g, "code block")
      .replace(/[#>*_`~]/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/\n{2,}/g, "\n")
      .trim()
      .slice(0, 2500);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.85,
            style: 0.35,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log("ELEVENLABS ERROR:", errorText);

      return res.status(response.status).json({
        error: errorText,
      });
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.send(audioBuffer);
  } catch (error) {
    console.log("TTS SERVER ERROR:", error.message);

    res.status(500).json({
      error: error.message,
    });
  }
});

/* =========================
   DOCUMENT READER v2
   Reliable PDF / DOCX / TXT extractor
========================= */

function normalizeExtractedText(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

app.post("/read-document", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const file = req.file;
    const name = (file.originalname || "upload").toLowerCase();
    const mime = file.mimetype || "";
    let text = "";
    let reader = "text";

    if (/\.pdf$/i.test(name) || mime.includes("pdf")) {
      reader = "pdf-parse";
      const data = await pdfParse(file.buffer, { max: 0 });
      text = data.text || "";
    } else if (/\.docx$/i.test(name) || mime.includes("wordprocessingml")) {
      reader = "mammoth-docx";
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value || "";

      // Fallback for DOCX files where raw text extraction returns empty.
      // Some DOCX files store useful content in tables/text boxes that raw mode can miss.
      if (!normalizeExtractedText(text)) {
        try {
          const htmlResult = await mammoth.convertToHtml({ buffer: file.buffer });
          const htmlText = String(htmlResult.value || "")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"');
          if (normalizeExtractedText(htmlText)) {
            reader = "mammoth-docx-html-fallback";
            text = htmlText;
          }
        } catch (fallbackError) {
          console.log("DOCX HTML FALLBACK ERROR:", fallbackError.message);
        }
      }
    } else if (/\.doc$/i.test(name)) {
      return res.status(415).json({
        error: "Old .doc files are not supported. Please convert it to .docx or PDF and upload again.",
      });
    } else {
      reader = "plain-text";
      text = file.buffer.toString("utf8");
    }

    text = normalizeExtractedText(text);

    if (!text) {
      return res.json({
        success: true,
        fileName: file.originalname,
        reader,
        pages: null,
        chars: 0,
        text: "[No selectable text found. This may be a scanned PDF/image-only document.]",
      });
    }

    res.json({
      success: true,
      fileName: file.originalname,
      reader,
      chars: text.length,
      text,
    });
  } catch (error) {
    console.log("DOCUMENT READ ERROR:", error.message);
    res.status(500).json({
      error: error.message || "Document read failed.",
    });
  }
});


/* =========================
   PHASE 6.7 PROJECT MEMORY ENGINE
   Persistent project workspace + version snapshots
========================= */

const PROJECT_MEMORY_FILE = path.join(__dirname, "project-memory.json");
const MAX_PROJECT_SNAPSHOTS = 12;

function loadProjectMemoryStore() {
  try {
    if (!fs.existsSync(PROJECT_MEMORY_FILE)) {
      fs.writeFileSync(PROJECT_MEMORY_FILE, "{}", "utf8");
    }

    const raw = fs.readFileSync(PROJECT_MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.log("PROJECT MEMORY LOAD ERROR:", error.message);
    return {};
  }
}

function saveProjectMemoryStore(store) {
  const tempFile = `${PROJECT_MEMORY_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempFile, PROJECT_MEMORY_FILE);
}

function normalizeProjectMemoryFiles(projectFiles = {}) {
  const normalized = {};

  Object.entries(projectFiles || {}).forEach(([fileName, value]) => {
    const safeName = String(fileName || "").replace(/\\/g, "/").trim();
    if (!safeName || safeName.includes("../")) return;

    const code = typeof value === "string" ? value : value?.code;
    if (typeof code !== "string") return;

    normalized[safeName] = {
      name: value?.name || safeName,
      lang: value?.lang || path.extname(safeName).replace(".", "") || "text",
      code,
    };
  });

  return normalized;
}

function getProjectMemoryUserKey(userEmail = "guest") {
  return String(userEmail || "guest").trim().toLowerCase() || "guest";
}

app.get("/project-memory", (req, res) => {
  try {
    const userKey = getProjectMemoryUserKey(req.query.userEmail);
    const store = loadProjectMemoryStore();
    const project = store[userKey]?.current || null;
    const snapshots = (store[userKey]?.snapshots || []).map((snapshot) => ({
      id: snapshot.id,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      fileCount: Object.keys(snapshot.projectFiles || {}).length,
    }));

    return res.json({
      success: true,
      project,
      snapshots,
      snapshotCount: snapshots.length,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/project-memory/save", (req, res) => {
  try {
    const {
      userEmail = "guest",
      projectName = "Current SYNEZ Project",
      projectFiles = {},
      activeProjectFile = "",
      updatedAt = Date.now(),
    } = req.body || {};

    const userKey = getProjectMemoryUserKey(userEmail);
    const normalizedFiles = normalizeProjectMemoryFiles(projectFiles);
    const store = loadProjectMemoryStore();

    if (!store[userKey]) store[userKey] = { current: null, snapshots: [] };

    if (!Object.keys(normalizedFiles).length) {
      return res.status(400).json({
        success: false,
        error: "Refusing to overwrite Project Memory with an empty project.",
        project: store[userKey].current || null,
      });
    }

    store[userKey].current = {
      projectName: String(projectName || "Current SYNEZ Project").slice(0, 120),
      projectFiles: normalizedFiles,
      activeProjectFile:
        activeProjectFile && normalizedFiles[activeProjectFile]
          ? activeProjectFile
          : Object.keys(normalizedFiles)[0] || "",
      updatedAt: Number(updatedAt) || Date.now(),
      fileCount: Object.keys(normalizedFiles).length,
    };

    saveProjectMemoryStore(store);

    return res.json({
      success: true,
      project: store[userKey].current,
    });
  } catch (error) {
    console.log("PROJECT MEMORY SAVE ERROR:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/project-memory/capture", (req, res) => {
  try {
    const {
      userEmail = "guest",
      projectName = "SYNEZ AI Workspace",
      projectFiles = {},
      activeProjectFile = "",
      diagnostics = {},
      createSnapshot = true,
    } = req.body || {};

    const userKey = getProjectMemoryUserKey(userEmail);
    const store = loadProjectMemoryStore();
    if (!store[userKey]) store[userKey] = { current: null, snapshots: [] };

    // Use current generated/uploaded files when present. Otherwise capture the actual
    // running SYNEZ project through the Coding Agent self-project fallback.
    const sourceFiles = Object.keys(normalizeProjectMemoryFiles(projectFiles)).length
      ? projectFiles
      : ensureProjectFilesForAgent({});
    const normalizedFiles = normalizeProjectMemoryFiles(sourceFiles);

    if (!Object.keys(normalizedFiles).length) {
      return res.status(400).json({ success: false, error: "No project files could be captured." });
    }

    const analysis = buildProjectAnalysis(normalizedFiles, diagnostics);
    const now = Date.now();
    const safeActive =
      activeProjectFile && normalizedFiles[activeProjectFile]
        ? activeProjectFile
        : analysis?.entryFiles?.app || Object.keys(normalizedFiles)[0] || "";

    const current = {
      projectName: String(projectName || "SYNEZ AI Workspace").slice(0, 120),
      projectFiles: normalizedFiles,
      activeProjectFile: safeActive,
      updatedAt: now,
      fileCount: Object.keys(normalizedFiles).length,
      analysis,
      version: `v${now}`,
    };

    store[userKey].current = current;

    let snapshotSummary = null;
    if (createSnapshot) {
      const snapshot = {
        id: `snapshot_${now}_${Math.random().toString(36).slice(2, 8)}`,
        label: `${current.projectName} — synced`,
        createdAt: now,
        projectFiles: normalizedFiles,
        activeProjectFile: safeActive,
        analysis,
        version: current.version,
      };
      store[userKey].snapshots = [snapshot, ...(store[userKey].snapshots || [])].slice(0, MAX_PROJECT_SNAPSHOTS);
      snapshotSummary = {
        id: snapshot.id,
        label: snapshot.label,
        createdAt: snapshot.createdAt,
        fileCount: Object.keys(snapshot.projectFiles).length,
      };
    }

    saveProjectMemoryStore(store);

    return res.json({
      success: true,
      project: current,
      analysis,
      snapshot: snapshotSummary,
      snapshotCount: (store[userKey].snapshots || []).length,
    });
  } catch (error) {
    console.log("PROJECT MEMORY CAPTURE ERROR:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/project-memory/snapshot", (req, res) => {
  try {
    const {
      userEmail = "guest",
      label = "Project snapshot",
      projectFiles = {},
      activeProjectFile = "",
    } = req.body || {};

    const userKey = getProjectMemoryUserKey(userEmail);
    const normalizedFiles = normalizeProjectMemoryFiles(projectFiles);
    const store = loadProjectMemoryStore();

    if (!store[userKey]) store[userKey] = { current: null, snapshots: [] };

    const snapshot = {
      id: `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: String(label || "Project snapshot").slice(0, 120),
      createdAt: Date.now(),
      projectFiles: normalizedFiles,
      activeProjectFile:
        activeProjectFile && normalizedFiles[activeProjectFile]
          ? activeProjectFile
          : Object.keys(normalizedFiles)[0] || "",
    };

    store[userKey].snapshots = [
      snapshot,
      ...(store[userKey].snapshots || []),
    ].slice(0, MAX_PROJECT_SNAPSHOTS);

    saveProjectMemoryStore(store);

    return res.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        label: snapshot.label,
        createdAt: snapshot.createdAt,
        fileCount: Object.keys(snapshot.projectFiles).length,
      },
    });
  } catch (error) {
    console.log("PROJECT SNAPSHOT ERROR:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/project-memory/restore", (req, res) => {
  try {
    const { userEmail = "guest", snapshotId = "" } = req.body || {};
    const userKey = getProjectMemoryUserKey(userEmail);
    const store = loadProjectMemoryStore();
    const userStore = store[userKey];

    if (!userStore) {
      return res.status(404).json({ success: false, error: "Project memory not found." });
    }

    const snapshot = (userStore.snapshots || []).find((item) => item.id === snapshotId);
    if (!snapshot) {
      return res.status(404).json({ success: false, error: "Snapshot not found." });
    }

    userStore.current = {
      projectName: snapshot.label || "Restored project",
      projectFiles: snapshot.projectFiles,
      activeProjectFile: snapshot.activeProjectFile,
      updatedAt: Date.now(),
      fileCount: Object.keys(snapshot.projectFiles || {}).length,
      restoredFrom: snapshot.id,
    };

    saveProjectMemoryStore(store);

    return res.json({ success: true, project: userStore.current });
  } catch (error) {
    console.log("PROJECT RESTORE ERROR:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/project-memory", (req, res) => {
  try {
    const userKey = getProjectMemoryUserKey(req.query.userEmail);
    const store = loadProjectMemoryStore();
    delete store[userKey];
    saveProjectMemoryStore(store);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});



/* =========================
   PHASE 7.1–7.3 SOFTWARE ENGINEER PRO
   Planner → Approval → Patch → Snapshot → Verification
========================= */

const ENGINEERING_PLAN_FILE = path.join(__dirname, "engineering-plans.json");

function loadEngineeringPlans() {
  try {
    if (!fs.existsSync(ENGINEERING_PLAN_FILE)) {
      fs.writeFileSync(ENGINEERING_PLAN_FILE, JSON.stringify({ plans: [] }, null, 2));
    }
    const parsed = JSON.parse(fs.readFileSync(ENGINEERING_PLAN_FILE, "utf8"));
    return parsed && Array.isArray(parsed.plans) ? parsed : { plans: [] };
  } catch (error) {
    console.log("ENGINEERING PLAN STORE ERROR:", error.message);
    return { plans: [] };
  }
}

function saveEngineeringPlans(store) {
  fs.writeFileSync(ENGINEERING_PLAN_FILE, JSON.stringify(store, null, 2));
}

function makeEngineeringId(prefix = "plan") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEngineeringFiles(projectFiles = {}) {
  const output = {};
  Object.entries(projectFiles || {}).forEach(([name, value]) => {
    const code = typeof value === "string" ? value : value?.code;
    if (!name || typeof code !== "string") return;
    output[name] = {
      name,
      lang: typeof value === "object" && value?.lang ? value.lang : path.extname(name).slice(1) || "text",
      code,
    };
  });
  return output;
}

function resolveEngineeringProjectFiles(projectFiles = {}, userEmail = "guest") {
  let normalized = normalizeEngineeringFiles(projectFiles);
  if (Object.keys(normalized).length) return normalized;

  try {
    const userKey = getProjectMemoryUserKey(userEmail);
    const memoryStore = loadProjectMemoryStore();
    normalized = normalizeEngineeringFiles(memoryStore?.[userKey]?.current?.projectFiles || {});
    if (Object.keys(normalized).length) return normalized;
  } catch (error) {
    console.log("ENGINEERING PROJECT MEMORY FALLBACK ERROR:", error.message);
  }

  // Final fallback: inspect the currently running SYNEZ project from disk.
  return normalizeEngineeringFiles(ensureProjectFilesForAgent({}));
}

function buildProjectInventory(projectFiles = {}) {
  return Object.entries(normalizeEngineeringFiles(projectFiles)).map(([name, file]) => ({
    name,
    language: file.lang,
    characters: file.code.length,
    lines: file.code.split("\n").length,
    imports: [...file.code.matchAll(/import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]).slice(0, 20),
  }));
}

function isGreenfieldEngineeringRequest(instruction = "") {
  const t = String(instruction || "").toLowerCase();
  const buildIntent = /\b(build|create|generate|develop|make)\b[\s\S]{0,120}\b(app|application|platform|workspace|website|dashboard|portal|saas|system|project)\b/i.test(t);
  const currentScope = /\b(current|existing|remembered|loaded|this)\s+(project|codebase|app|application|website)\b/i.test(t);
  const editIntent = /\b(fix|improve|update|modify|refactor|repair|optimi[sz]e)\b/i.test(t);
  return buildIntent && !currentScope && !editIntent;
}

function detectAffectedFiles(instruction = "", projectFiles = {}) {
  const t = String(instruction || "").toLowerCase();
  const names = Object.keys(projectFiles || {});
  const selected = new Set();
  const addMatches = (regex) => names.filter((name) => regex.test(name)).forEach((name) => selected.add(name));

  if (/css|style|responsive|layout|animation|theme|ui\b|mobile|tablet|desktop/.test(t)) {
    addMatches(/\.css$/i);
    addMatches(/(^|\/)App\.(jsx|tsx|js)$/i);
  }
  if (/backend|api|route|express|server/.test(t)) addMatches(/server|route|controller|api/i);
  if (/firebase|auth|login|firestore/.test(t)) addMatches(/firebase|auth|login|protected/i);
  if (/preview|runtime|canvas|devtools|console/.test(t)) addMatches(/App\.(jsx|tsx|js)$|preview|runtime|devtools/i);
  if (/navbar|header|sidebar|footer|component/.test(t)) addMatches(/navbar|header|sidebar|footer|component|App\.(jsx|tsx|js)$/i);
  if (/package|dependency|install/.test(t)) addMatches(/package\.json$/i);

  const explicit = [...String(instruction || "").matchAll(/([\w./-]+\.(?:jsx|tsx|js|ts|css|json|html|md))/gi)].map((m) => m[1]);
  explicit.forEach((requested) => {
    const exact = names.find((name) => name.toLowerCase() === requested.toLowerCase() || name.toLowerCase().endsWith(`/${requested.toLowerCase()}`));
    if (exact) selected.add(exact);
  });

  if (!selected.size) {
    names.filter((name) => /(^|\/)App\.(jsx|tsx|js)$|server\.js$|\.css$/i.test(name)).slice(0, 4).forEach((name) => selected.add(name));
  }
  if (!selected.size && names.length) {
    names.filter((name) => !/package-lock|node_modules|dist|build/i.test(name)).slice(0, 4).forEach((name) => selected.add(name));
  }
  return [...selected].slice(0, 8);
}

function buildEngineeringPlanMarkdown(plan) {
  const affected = plan.affectedFiles.length ? plan.affectedFiles.map((f) => `- \`${f}\``).join("\n") : "- No confirmed files yet";
  return `## 🧭 Software Engineering Plan\n\n**Plan ID:** \`${plan.id}\`  \n**Status:** Awaiting approval  \n**Confidence:** ${plan.confidence}%  \n**Risk:** ${plan.risk}\n\n### Executive Summary\n${plan.summary}\n\n### Requirements\n${plan.requirements.map((item) => `- ${item}`).join("\n")}\n\n### Affected Files\n${affected}\n\n### Architecture & Implementation\n${plan.steps.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n\n### Verification Plan\n${plan.verification.map((item) => `- ${item}`).join("\n")}\n\n### Estimates\n- Files: ${plan.affectedFiles.length || "TBD"}\n- Estimated LOC: ${plan.estimatedLoc}\n- Complexity: ${plan.complexity}\n\n### Risks\n${plan.risks.map((item) => `- ${item}`).join("\n")}\n\n**No files were modified. Approve, modify, or reject this plan.**`;
}

function createDeterministicEngineeringPlan({ instruction = "", projectFiles = {}, projectName = "Current Project" }) {
  const greenfield = isGreenfieldEngineeringRequest(instruction);
  const inventory = buildProjectInventory(projectFiles);
  const architecturePlan = greenfield ? buildProjectArchitecturePlan(instruction) : null;
  const proposedFiles = greenfield ? (architecturePlan?.files || []).slice(0, 30) : [];
  const affectedFiles = greenfield ? proposedFiles : detectAffectedFiles(instruction, projectFiles);
  const complexity = greenfield || affectedFiles.length > 5 ? "High" : affectedFiles.length > 2 ? "Medium" : "Low";
  const risk = greenfield || /refactor|architecture|database|auth|security|multi-file|entire/i.test(instruction) ? "Medium" : "Low";
  const requirements = String(instruction || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const id = makeEngineeringId("plan");
  return {
    id,
    mode: greenfield ? "greenfield" : "existing_project",
    projectName: greenfield ? (architecturePlan?.type || projectName) : projectName,
    instruction,
    createdAt: Date.now(),
    status: "awaiting_approval",
    confidence: greenfield ? 90 : inventory.length && affectedFiles.length ? 92 : inventory.length ? 76 : 55,
    complexity,
    risk,
    summary: greenfield
      ? `Plan and build a new ${architecturePlan?.type || "application"} incrementally using the exact requested stack and requirements.`
      : `Implement the requested change in ${projectName} using minimal, project-aware edits while preserving unrelated UI and behavior.`,
    requirements: requirements.length ? requirements : ["Apply the requested project change safely."],
    affectedFiles,
    proposedFiles,
    architecturePlan,
    inventory,
    estimatedLoc: greenfield
      ? `${Math.max(400, proposedFiles.length * 70)}–${Math.max(900, proposedFiles.length * 160)}`
      : affectedFiles.length ? `${Math.max(20, affectedFiles.length * 35)}–${Math.max(50, affectedFiles.length * 90)}` : "TBD",
    steps: greenfield
      ? [
          "Confirm the exact requested stack, pages, modules, and data model.",
          "Create the approved folder structure and core entry files.",
          "Generate the project incrementally in safe batches.",
          "Build shared layout, authentication, database, API, and feature modules.",
          "Refresh the preview after every generated batch.",
          "Verify imports, runtime, routes, responsiveness, and requested functionality.",
        ]
      : [
          "Inspect the dependency graph and current implementation of the affected modules.",
          "Create a pre-change project snapshot.",
          "Generate a minimal Git-style patch for only the affected files.",
          "Apply the patch only after explicit approval.",
          "Refresh the preview and verify imports, runtime, API routes, and UI stability.",
          "Automatically roll back if verification reports a confirmed regression.",
        ],
    verification: [
      "Validate changed file syntax and imports.",
      "Reload the preview and inspect runtime/console evidence.",
      "Confirm requested behavior without unrelated UI changes.",
      "Keep verification PENDING when no real runtime evidence is available.",
    ],
    risks: [
      "Model-generated patches can be incomplete; file-count and path safety limits are enforced.",
      "Large files may be context-trimmed, so only high-confidence edits should be applied.",
      "Package changes remain locked unless the request explicitly requires a dependency.",
    ],
  };
}

function parseJsonObjectFromText(text = "") {
  const cleaned = String(text || "").replace(/```json|```/gi, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  return null;
}

function buildSimpleUnifiedDiff(fileName, oldCode = "", newCode = "") {
  if (oldCode === newCode) return "";
  const oldLines = String(oldCode).split("\n");
  const newLines = String(newCode).split("\n");
  const max = Math.max(oldLines.length, newLines.length);
  const lines = [`--- ${fileName}`, `+++ ${fileName}`];
  let shown = 0;
  for (let i = 0; i < max && shown < 240; i += 1) {
    const before = oldLines[i];
    const after = newLines[i];
    if (before === after) continue;
    lines.push(`@@ line ${i + 1} @@`);
    if (before !== undefined) lines.push(`-${before}`);
    if (after !== undefined) lines.push(`+${after}`);
    shown += 1;
  }
  if (shown >= 240) lines.push("... diff truncated ...");
  return lines.join("\n");
}

async function generateEngineeringPatch(plan, projectFiles = {}) {
  const normalized = normalizeEngineeringFiles(projectFiles);
  const targets = (plan.affectedFiles || []).filter((name) => normalized[name]).slice(0, 8);
  if (!targets.length) throw new Error("No affected project files were available for patch generation.");

  let budget = 65000;
  const contextFiles = {};
  for (const name of targets) {
    const code = normalized[name].code;
    if (budget <= 0) break;
    const clipped = code.slice(0, Math.min(code.length, budget));
    contextFiles[name] = clipped;
    budget -= clipped.length;
  }

  const prompt = `You are SYNEZ AI Software Engineer Pro.\nReturn ONLY valid JSON.\n\nUser request:\n${plan.instruction}\n\nApproved plan affected files:\n${targets.join("\n")}\n\nProject files:\n${Object.entries(contextFiles).map(([name, code]) => `--- ${name} ---\n${code}`).join("\n\n")}\n\nJSON schema:\n{\n  "summary": "brief summary",\n  "files": [\n    {"path": "exact existing path", "code": "complete replacement code", "reason": "why changed"}\n  ]\n}\n\nRules:\n- Modify only listed affected files.\n- Return complete code for every changed file.\n- Preserve UI unless explicitly requested.\n- Do not modify package.json unless it is in affected files and strictly required.\n- Maximum 8 files.\n- Do not include markdown fences.`;

  const reply = await callGroq("llama-3.3-70b-versatile", [{ role: "user", content: prompt }], "Return strict JSON only.");
  const parsed = parseJsonObjectFromText(reply);
  if (!parsed || !Array.isArray(parsed.files)) throw new Error("Patch model returned invalid JSON.");

  const safeFiles = [];
  for (const item of parsed.files.slice(0, 8)) {
    const filePath = String(item?.path || "").trim();
    const code = String(item?.code || "");
    if (!targets.includes(filePath) || !code.trim()) continue;
    if (/package\.json$/i.test(filePath) && !/dependency|package|install/i.test(plan.instruction)) continue;
    safeFiles.push({ path: filePath, code, reason: String(item?.reason || "Approved project change") });
  }
  if (!safeFiles.length) throw new Error("No safe file changes were produced.");
  return { summary: parsed.summary || "Approved project patch", files: safeFiles };
}

app.post("/software-engineer/plan", async (req, res) => {
  try {
    const { instruction = "", projectFiles = {}, projectName = "Current SYNEZ Project", userEmail = "guest" } = req.body || {};
    if (!String(instruction).trim()) return res.status(400).json({ success: false, error: "Instruction is required." });
    const greenfield = isGreenfieldEngineeringRequest(instruction);
    const normalized = greenfield ? {} : resolveEngineeringProjectFiles(projectFiles, userEmail);
    if (!greenfield && !Object.keys(normalized).length) {
      return res.status(400).json({ success: false, error: "No current project files were found. Open a generated project or verify the backend project path." });
    }
    const plan = createDeterministicEngineeringPlan({ instruction, projectFiles: normalized, projectName });
    plan.userEmail = userEmail;
    const store = loadEngineeringPlans();
    store.plans = [plan, ...store.plans.filter((item) => item.id !== plan.id)].slice(0, 80);
    saveEngineeringPlans(store);
    return res.json({ success: true, plan, reply: buildEngineeringPlanMarkdown(plan), provider: "SYNEZ Software Engineer Pro", model: "Phase 7.1–7.3 Planner" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

async function generateGreenfieldEngineeringProject(plan) {
  const targets = (plan.proposedFiles || plan.affectedFiles || []).filter(Boolean).slice(0, 12);
  if (!targets.length) throw new Error("The approved new-project plan does not contain a file structure.");

  const prompt = `You are SYNEZ AI Software Engineer Pro. Return ONLY valid JSON.

Create the first complete runnable batch for this approved new project.

User request:
${plan.instruction}

Exact approved file paths (create only these in this batch):
${targets.join("\n")}

JSON schema:
{
  "summary": "brief summary",
  "files": [
    {"path": "exact approved path", "code": "complete file code", "reason": "purpose"}
  ]
}

Rules:
- Follow the user's exact stack; do not silently replace Firebase, Firestore, React, Vite, or Express.
- Create coherent runnable files with valid imports.
- Do not include markdown fences.
- Maximum 12 files.`;

  const reply = await callGroq("llama-3.3-70b-versatile", [{ role: "user", content: prompt }], "Return strict JSON only.");
  const parsed = parseJsonObjectFromText(reply);
  if (!parsed || !Array.isArray(parsed.files)) throw new Error("Project generator returned invalid JSON.");
  const safeFiles = parsed.files.slice(0, 12).map((item) => ({
    path: String(item?.path || "").trim(),
    code: String(item?.code || ""),
    reason: String(item?.reason || "Initial approved project file"),
  })).filter((item) => targets.includes(item.path) && item.code.trim());
  if (!safeFiles.length) throw new Error("No safe project files were generated.");
  return { summary: parsed.summary || "Initial approved project batch generated.", files: safeFiles };
}

app.post("/software-engineer/decision", async (req, res) => {
  try {
    const { planId = "", action = "", modification = "", projectFiles = {}, activeProjectFile = "", userEmail = "guest" } = req.body || {};
    const store = loadEngineeringPlans();
    const plan = store.plans.find((item) => item.id === planId);
    if (!plan) return res.status(404).json({ success: false, error: "Engineering plan not found." });

    if (action === "reject") {
      plan.status = "rejected";
      plan.updatedAt = Date.now();
      saveEngineeringPlans(store);
      return res.json({ success: true, status: "rejected", reply: `## Plan Rejected\n\nPlan \`${plan.id}\` was rejected. No files were modified.` });
    }

    if (action === "modify") {
      plan.status = "superseded";
      plan.updatedAt = Date.now();
      const revised = createDeterministicEngineeringPlan({
        instruction: `${plan.instruction}\n\nRequested modification:\n${modification || "Revise the plan."}`,
        projectFiles: resolveEngineeringProjectFiles(projectFiles, userEmail),
        projectName: plan.projectName,
      });
      revised.userEmail = userEmail;
      revised.parentPlanId = plan.id;
      store.plans = [revised, ...store.plans].slice(0, 80);
      saveEngineeringPlans(store);
      return res.json({ success: true, status: "awaiting_approval", plan: revised, reply: buildEngineeringPlanMarkdown(revised), provider: "SYNEZ Software Engineer Pro", model: "Revised Planner" });
    }

    if (action !== "apply") return res.status(400).json({ success: false, error: "Action must be apply, modify, or reject." });
    if (plan.status !== "awaiting_approval") return res.status(409).json({ success: false, error: `Plan is already ${plan.status}.` });

    const normalized = plan.mode === "greenfield" ? {} : resolveEngineeringProjectFiles(projectFiles, userEmail);
    if (plan.mode !== "greenfield" && !Object.keys(normalized).length) {
      return res.status(400).json({ success: false, error: "Current project files could not be resolved from the active editor, Project Memory, or the running SYNEZ project." });
    }

    const userKey = getProjectMemoryUserKey(userEmail);
    const memoryStore = loadProjectMemoryStore();
    if (!memoryStore[userKey]) memoryStore[userKey] = { current: null, snapshots: [] };
    const snapshot = {
      id: makeEngineeringId("snapshot"),
      label: `Before ${plan.id}`,
      createdAt: Date.now(),
      projectFiles: normalized,
      activeProjectFile,
    };
    memoryStore[userKey].snapshots = [snapshot, ...(memoryStore[userKey].snapshots || [])].slice(0, MAX_PROJECT_SNAPSHOTS);
    saveProjectMemoryStore(memoryStore);

    const generated = plan.mode === "greenfield"
      ? await generateGreenfieldEngineeringProject(plan)
      : await generateEngineeringPatch(plan, normalized);
    const nextFiles = { ...normalized };
    const diffs = [];
    generated.files.forEach((item) => {
      const previous = normalized[item.path]?.code || "";
      nextFiles[item.path] = { ...normalized[item.path], name: item.path, code: item.code };
      diffs.push({ path: item.path, reason: item.reason, diff: buildSimpleUnifiedDiff(item.path, previous, item.code) });
    });

    plan.status = "applied";
    plan.updatedAt = Date.now();
    plan.patchId = makeEngineeringId("patch");
    plan.snapshotId = snapshot.id;
    plan.changedFiles = generated.files.map((item) => item.path);
    plan.diffs = diffs;
    saveEngineeringPlans(store);

    const diffText = diffs.map((item) => `### ${item.path}\n\n\`\`\`diff\n${item.diff}\n\`\`\``).join("\n\n");
    return res.json({
      success: true,
      status: "applied",
      planId: plan.id,
      patchId: plan.patchId,
      snapshotId: snapshot.id,
      projectFiles: nextFiles,
      changedFiles: plan.changedFiles,
      diffs,
      verification: "PENDING",
      rollbackStatus: "AVAILABLE",
      reply: `## ✅ Approved Patch Applied\n\n**Patch ID:** \`${plan.patchId}\`  \n**Snapshot ID:** \`${snapshot.id}\`  \n**Changed files:** ${plan.changedFiles.length}  \n**Verification:** PENDING until preview/runtime evidence is collected.\n\n${generated.summary}\n\n${diffText}`,
      provider: "SYNEZ Software Engineer Pro",
      model: "Phase 7.1–7.3 Patch Manager",
    });
  } catch (error) {
    console.log("SOFTWARE ENGINEER DECISION ERROR:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/software-engineer/history", (req, res) => {
  const store = loadEngineeringPlans();
  const userEmail = String(req.query.userEmail || "guest").toLowerCase();
  const plans = store.plans.filter((item) => String(item.userEmail || "guest").toLowerCase() === userEmail).slice(0, 30);
  return res.json({ success: true, plans });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`SYNEZ AI server running on port ${PORT}`);

  if (SERPER_KEYS.length > 0) {
    console.log(`SERPER keys loaded ✅ (${SERPER_KEYS.length})`);
  } else {
    console.log("SERPER API key missing ❌");
  }
});