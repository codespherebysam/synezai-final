/**
 * Keyless image fallback providers.
 * They guarantee /generate-image keeps working even when every keyed vendor
 * is rate-limited or unreachable. Disable with DISABLED_PROVIDERS=pollinations.
 */

import { log } from "../core/log.js";

async function fetchImage(url, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "image/*" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`${res.status} ${text.slice(0, 160)}`.trim()), {
        status: res.status,
      });
    }
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) throw new Error(`unexpected content-type ${type}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error("image payload too small");
    return `data:${type};base64,${buf.toString("base64")}`;
  } finally {
    clearTimeout(timer);
  }
}

export const pollinations = {
  id: "pollinations",
  priority: 70,
  capabilities: ["image"],
  enabled: () => process.env.POLLINATIONS_DISABLED !== "true",

  async image({ prompt, width = 1024, height = 1024 }) {
    const seed = Math.floor(Math.random() * 1_000_000);
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;
    const dataUrl = await fetchImage(url);
    log.info("pollinations", "image ok");
    return { images: [dataUrl], model: "pollinations/flux" };
  },
};
