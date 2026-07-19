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

module.exports = {
  SERPER_KEYS,
  getSerperKey,
  cleanSnippet,
  shouldUseWikipedia,
  searchWikipedia,
  searchSerper,
  mergeUniqueResults,
};
