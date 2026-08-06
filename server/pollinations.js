/**
 * Hugging Face Inference — text-to-image.
 *
 * The legacy api-inference.huggingface.co host is being retired and now fails
 * DNS/TLS ("fetch failed") from many regions, so every configured base URL is
 * tried in order for every configured model, across every key in the pool.
 *
 * Configure with:
 *   HF_API_KEYS=k1,k2,k3            (comma separated, unlimited)
 *   HF_IMAGE_MODELS=owner/model,... (comma separated, tried in order)
 *   HF_BASE_URLS=https://...        (optional override of the host list)
 */

import { withKeys, hasKeys } from "../core/keys.js";
import { log } from "../core/log.js";

const DEFAULT_MODELS =
  "black-forest-labs/FLUX.1-schnell,stabilityai/stable-diffusion-xl-base-1.0,stabilityai/stable-diffusion-3.5-large-turbo,runwayml/stable-diffusion-v1-5";

const DEFAULT_BASES =
  "https://router.huggingface.co/hf-inference/models,https://api-inference.huggingface.co/models";

const list = (raw, fallback) =>
  (raw ?? fallback)
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);

const models = () => list(process.env.HF_IMAGE_MODELS, DEFAULT_MODELS);
const bases = () => list(process.env.HF_BASE_URLS, DEFAULT_BASES);

async function once({ base, model, key, prompt }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(`${base}/${model}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {},
        options: { wait_for_model: true, use_cache: false },
      }),
    });

    const type = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(
        new Error(`${res.status} ${res.statusText} ${text.slice(0, 180)}`.trim()),
        { status: res.status },
      );
    }
    if (type.includes("application/json") || type.includes("text/")) {
      const text = await res.text().catch(() => "");
      throw new Error(`model returned no image: ${text.slice(0, 180)}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error("image payload too small");
    return {
      images: [`data:${type || "image/png"};base64,${buf.toString("base64")}`],
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const huggingface = {
  id: "huggingface",
  priority: 10,
  capabilities: ["image"],
  enabled: () => hasKeys("HF"),

  async image({ prompt }) {
    const errors = [];
    for (const model of models()) {
      for (const base of bases()) {
        try {
          const out = await withKeys("HF", (key) => once({ base, model, key, prompt }));
          log.info("huggingface", `image ok via ${base}/${model}`);
          return out;
        } catch (err) {
          errors.push(`${model}@${base.replace(/^https?:\/\//, "")}: ${err.message}`);
          log.warn("huggingface", `image failed ${model} @ ${base}`, err.message);
        }
      }
    }
    throw new Error(`huggingface image failed → ${errors.join(" | ").slice(0, 500)}`);
  },
};
