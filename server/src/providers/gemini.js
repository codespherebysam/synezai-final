/** Google Gemini — chat, vision and image generation through the native REST API. */

import { request } from "../core/http.js";
import { withKeys, hasKeys } from "../core/keys.js";
import { log } from "../core/log.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function toGemini(messages) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n\n");

  const contents = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "model" : "user";
    const parts = [];
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === "text" && p.text) parts.push({ text: p.text });
        if (p.type === "image_url") {
          const url = p.image_url?.url ?? "";
          const match = /^data:([^;]+);base64,(.+)$/.exec(url);
          if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
          else if (url) parts.push({ text: `Image URL: ${url}` });
        }
      }
    } else if (m.content) {
      parts.push({ text: String(m.content) });
    }
    if (parts.length) contents.push({ role, parts });
  }
  return { system, contents };
}

const model = (kind) =>
  kind === "vision"
    ? (process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.0-flash")
    : (process.env.GEMINI_MODEL ?? "gemini-2.0-flash");

const imageModels = () =>
  (process.env.GEMINI_IMAGE_MODELS ?? "gemini-2.5-flash-image,gemini-2.0-flash-preview-image-generation")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function generate(messages, kind, temperature) {
  const { system, contents } = toGemini(messages);
  if (!contents.length) throw new Error("gemini: no usable message content");
  return withKeys("GEMINI", async (key) => {
    const res = await request(`${BASE}/${model(kind)}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      retries: 0,
      timeoutMs: 150_000,
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { temperature },
      }),
    });
    const content =
      res?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!content) throw new Error("gemini: empty completion");
    return { content, model: model(kind) };
  });
}

export const gemini = {
  id: "gemini",
  priority: 15,
  capabilities: ["chat", "vision", "image"],
  enabled: () => hasKeys("GEMINI"),
  chat: ({ messages, temperature = 0.7 }) => generate(messages, "chat", temperature),
  vision: ({ messages, temperature = 0.3 }) => generate(messages, "vision", temperature),

  async image({ prompt }) {
    const errors = [];
    for (const m of imageModels()) {
      try {
        return await withKeys("GEMINI", async (key) => {
          const res = await request(`${BASE}/${m}:generateContent?key=${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            retries: 0,
            timeoutMs: 150_000,
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
            }),
          });
          const parts = res?.candidates?.[0]?.content?.parts ?? [];
          const images = parts
            .map((p) => p.inlineData ?? p.inline_data)
            .filter(Boolean)
            .map((d) => `data:${d.mimeType ?? d.mime_type ?? "image/png"};base64,${d.data}`);
          if (!images.length) throw new Error("no inline image returned");
          log.info("gemini", `image ok via ${m}`);
          return { images, model: m };
        });
      } catch (err) {
        errors.push(`${m}: ${err.message}`);
        log.warn("gemini", `image failed ${m}`, err.message);
      }
    }
    throw new Error(`gemini image failed → ${errors.join(" | ").slice(0, 400)}`);
  },
};
