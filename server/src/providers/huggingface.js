/** Hugging Face Inference — text-to-image (and a text fallback). */

import { withKeys, hasKeys } from "../core/keys.js";

const BASE = "https://api-inference.huggingface.co/models";
const models = () =>
  (process.env.HF_IMAGE_MODELS ??
    "black-forest-labs/FLUX.1-schnell,stabilityai/stable-diffusion-xl-base-1.0,runwayml/stable-diffusion-v1-5")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

export const huggingface = {
  id: "huggingface",
  priority: 10,
  capabilities: ["image"],
  enabled: () => hasKeys("HF"),

  async image({ prompt }) {
    let lastErr;
    for (const model of models()) {
      try {
        return await withKeys("HF", async (key) => {
          const res = await fetch(`${BASE}/${model}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              inputs: prompt,
              options: { wait_for_model: true, use_cache: false },
            }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw Object.assign(new Error(text.slice(0, 200) || res.statusText), {
              status: res.status,
            });
          }
          const type = res.headers.get("content-type") ?? "image/png";
          if (type.includes("application/json")) {
            const body = await res.json();
            throw new Error(body?.error ?? "model returned no image");
          }
          const buf = Buffer.from(await res.arrayBuffer());
          return {
            images: [`data:${type};base64,${buf.toString("base64")}`],
            model,
          };
        });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("huggingface: image generation failed");
  },
};
