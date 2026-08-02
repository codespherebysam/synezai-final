/** Serper.dev — Google search grounding with sources and timestamps. */

import { request } from "../core/http.js";
import { withKeys, hasKeys } from "../core/keys.js";

export const serper = {
  id: "serper",
  priority: 10,
  capabilities: ["search"],
  enabled: () => hasKeys("SERPER"),

  async search({ query, num = 6 }) {
    return withKeys("SERPER", async (key) => {
      const res = await request("https://google.serper.dev/search", {
        method: "POST",
        retries: 0,
        timeoutMs: 30_000,
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num }),
      });
      const fetchedAt = new Date().toISOString();
      const results = [
        ...(res.answerBox
          ? [
              {
                title: res.answerBox.title ?? "Answer",
                url: res.answerBox.link ?? "",
                snippet: res.answerBox.answer ?? res.answerBox.snippet ?? "",
                fetchedAt,
              },
            ]
          : []),
        ...(res.knowledgeGraph?.description
          ? [
              {
                title: res.knowledgeGraph.title ?? query,
                url: res.knowledgeGraph.website ?? res.knowledgeGraph.descriptionLink ?? "",
                snippet: res.knowledgeGraph.description,
                fetchedAt,
              },
            ]
          : []),
        ...(res.organic ?? []).slice(0, num).map((r) => ({
          title: r.title,
          url: r.link,
          snippet: r.snippet ?? "",
          date: r.date,
          fetchedAt,
        })),
      ].filter((r) => r.title);

      return {
        results,
        answer: res.answerBox?.answer ?? "",
        fetchedAt,
      };
    });
  },
};

/** Wikipedia — always-on, keyless last-resort grounding. */
export const wikipedia = {
  id: "wikipedia",
  priority: 90,
  capabilities: ["search"],
  enabled: () => true,

  async search({ query, num = 3 }) {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=" +
      num +
      "&srsearch=" +
      encodeURIComponent(query);
    const res = await request(url, { timeoutMs: 20_000 });
    const fetchedAt = new Date().toISOString();
    const results = (res?.query?.search ?? []).map((r) => ({
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
      snippet: String(r.snippet ?? "").replace(/<[^>]+>/g, ""),
      fetchedAt,
    }));
    return { results, fetchedAt };
  },
};
