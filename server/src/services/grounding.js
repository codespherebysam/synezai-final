/** Live grounding: search first, never guess time-sensitive facts. */

import { run } from "../core/registry.js";

export async function groundedContext(query) {
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
