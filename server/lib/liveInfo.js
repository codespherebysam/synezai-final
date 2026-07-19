/* =========================
   INTENT ROUTER V2 HELPERS
   Weather / Time / Date / News.
========================= */

const { searchSerper } = require("./search");

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
  const known = [
    "Dhanbad", "Jharkhand", "Ranchi", "Bokaro", "Jamshedpur",
    "Delhi", "Mumbai", "Kolkata", "Bengaluru", "Bangalore",
    "Chennai", "Hyderabad", "Pune", "Ahmedabad", "Jaipur",
    "Lucknow", "India",
    "USA", "United States", "UK", "United Kingdom", "London",
    "New York", "China", "Russia", "Japan", "Pakistan", "Dubai",
  ];
  const found = known.find((name) => new RegExp(`\\b${name}\\b`, "i").test(t));
  // Empty string means "no specific place" -> caller should treat as global/world.
  return found || "";
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

async function getNewsResults(location = "") {
  // No specific place -> global/world news. A place -> news scoped to that place.
  const query = location
    ? `latest ${location} news today -instagram -facebook -youtube -shorts`
    : `latest world news today -instagram -facebook -youtube -shorts`;
  const results = await searchSerper(query, 10);
  return results
    .filter((item) => !isLowQualitySource(item))
    .slice(0, 6);
}

// Backwards-compatible alias.
async function getLocalNewsResults(location = "") {
  return getNewsResults(location);
}

async function buildQuickInfoResponse(userPrompt = "") {
  const location = extractLikelyLocation(userPrompt);
  const wantsNews = /\b(news|khabar|khabrein|samachar|latest|hua|kya kya hua)\b/i.test(userPrompt);
  const wantsWeather = /\b(weather|mausam|temperature|temp|rain|barish|humidity|wind|forecast)\b/i.test(userPrompt);
  const dateTime = getIndiaDateTimeParts();
  // Weather always needs a place; fall back to a sensible default only for weather.
  const weatherLocation = location || "Dhanbad, Jharkhand";
  const weather = wantsWeather ? await getWeatherSummary(weatherLocation) : null;
  const news = wantsNews ? await getNewsResults(location) : [];

  const scopeLabel = location || "Today";
  const newsScope = location || "World";

  const lines = [];
  lines.push(`### ${scopeLabel}`);
  lines.push(`**Date:** ${dateTime.dateOnly}`);
  lines.push(`**Day:** ${dateTime.weekday}`);
  lines.push(`**Current Time:** ${dateTime.timeOnly} IST`);

  if (weather) {
    lines.push("");
    lines.push(`### Weather${location ? ` — ${weatherLocation}` : ""}`);
    lines.push(`- **Condition:** ${weather.condition || "N/A"}`);
    lines.push(`- **Temperature:** ${weather.temperature}°C`);
    lines.push(`- **Feels like:** ${weather.feelsLike}°C`);
    lines.push(`- **Humidity:** ${weather.humidity}%`);
    lines.push(`- **Wind:** ${weather.wind} km/h`);
  }

  if (wantsNews) {
    lines.push("");
    lines.push(`### Verified ${newsScope} News`);

    if (news.length) {
      news.slice(0, 5).forEach((item, index) => {
        lines.push(`${index + 1}. **${item.title || "News update"}** — ${item.snippet || "Open the source for details."}`);
      });
      lines.push("");
      lines.push("_News items are based only on retrieved web sources. SYNEZ AI did not invent any event._");
    } else {
      lines.push("I could not retrieve reliable fresh news results right now. I will not invent news. Try again later or ask for a specific place.");
    }
  }

  return {
    reply: lines.join("\n"),
    provider: wantsNews ? "SYNEZ AI Search + Weather" : "SYNEZ AI Weather/Time",
    model: "Intent Router v2",
    task: "quick-info",
    sources: [
      ...(weather ? [{ title: "Weather source", snippet: "Current weather data", displayLink: "wttr.in", link: `https://wttr.in/${encodeURIComponent(weatherLocation)}` }] : []),
      ...news,
    ],
  };
}

module.exports = {
  isTimeDateWeatherNewsRequest,
  extractLikelyLocation,
  getIndiaDateTimeParts,
  getWeatherSummary,
  isLowQualitySource,
  getNewsResults,
  getLocalNewsResults,
  buildQuickInfoResponse,
};
