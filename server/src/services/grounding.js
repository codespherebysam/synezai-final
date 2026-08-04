/** Live grounding: search first, never guess time-sensitive facts. */

import { run } from "../core/registry.js";

const PRODUCT = /\b(iphone|ipad|macbook|galaxy|pixel|oneplus|xiaomi|redmi|playstation|ps5|xbox|rtx|tesla)\b/i;
const LATEST = /\b(latest|newest|current|most recent|new model)\b/i;
const LINEUP = /\b(all|list|lineup|line-?up|models|versions|range|every)\b/i;

/** Make product questions precise so "latest X" never returns an old model. */
export function refineQuery(query = "") {
  const year = new Date().getFullYear();
  if (!PRODUCT.test(query)) return query;
  if (LINEUP.test(query) && !LATEST.test(query))
    return `${query} all current models on sale ${year} full lineup`;
  if (LATEST.test(query)) return `${query} ${year} newest generation release date official`;
  return `${query} ${year}`;
}

export async function groundedContext(rawQuery) {
  const query = refineQuery(rawQuery);
  try {
    const out = await run("search", { query, num: 6 });
    const results = out.results ?? [];
    if (!results.length) return { context: "", sources: [] };
    const context =
      `LIVE SEARCH RESULTS (retrieved ${out.fetchedAt ?? new Date().toISOString()}) — ` +
      `use these as the source of truth and cite them as [n]:\n` +
      results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet ?? ""}`)
        .join("\n\n");
    return { context, sources: results };
  } catch {
    return {
      context: "LIVE SEARCH FAILED. Tell the user the live lookup failed instead of guessing.",
      sources: [],
    };
  }
}
