/**
 * Provider registry — the heart of the plug-and-play architecture.
 *
 * A provider is a plain object:
 *   {
 *     id: "groq",
 *     capabilities: ["chat", "stream"],   // chat | stream | vision | image | speech | transcribe | search | embed
 *     priority: 10,                       // lower runs first
 *     enabled(): boolean,                 // usually "do I have a key?"
 *     async chat({ messages, ...opts }): { content, provider, model }
 *     async stream({ messages, onToken, ...opts }): { content }
 *     async vision({ messages, images, ...opts }): { content }
 *     async image({ prompt }): { images: string[] }
 *     async speech({ text, voice }): { audio: Buffer, mime }
 *     async search({ query, num }): { results, answer }
 *   }
 *
 * Adding a provider = drop a file in src/providers and export it from
 * src/providers/index.js. No core file changes, no route changes.
 */

const registry = new Map();

export function register(provider) {
  if (!provider?.id) throw new Error("provider.id is required");
  registry.set(provider.id, { priority: 50, capabilities: [], ...provider });
  return provider;
}

export function all() {
  return [...registry.values()];
}

export function get(id) {
  return registry.get(id);
}

function envOrder(capability) {
  // e.g. PROVIDER_ORDER_CHAT="groq,gemini,openrouter" or global PROVIDER_ORDER
  const raw =
    process.env[`PROVIDER_ORDER_${capability.toUpperCase()}`] ??
    process.env.PROVIDER_ORDER ??
    "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const disabled = () =>
  (process.env.DISABLED_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Ordered, enabled providers for a capability.
 * Order: caller preference → env order → declared priority.
 */
export function candidates(capability, preferred = []) {
  const off = disabled();
  const pref = [...preferred, ...envOrder(capability)]
    .map((p) => String(p).toLowerCase())
    .filter((p) => p && p !== "auto");

  const usable = all().filter(
    (p) =>
      p.capabilities.includes(capability) &&
      typeof p[capability] === "function" &&
      !off.includes(p.id) &&
      (typeof p.enabled !== "function" || p.enabled()),
  );

  const rank = (p) => {
    const i = pref.indexOf(p.id);
    return i === -1 ? 1000 + p.priority : i;
  };
  return usable.sort((a, b) => rank(a) - rank(b));
}

/**
 * Run a capability across providers with automatic fallback.
 * Returns { ...result, provider } from the first one that succeeds.
 */
export async function run(capability, payload = {}, { preferred = [], onAttempt } = {}) {
  const list = candidates(capability, preferred);
  if (!list.length) {
    throw Object.assign(new Error(`No provider available for "${capability}".`), { status: 503 });
  }
  const errors = [];
  for (const provider of list) {
    try {
      onAttempt?.(provider.id);
      const result = await provider[capability](payload);
      if (result && (result.content || result.images || result.audio || result.results || result.text)) {
        return { ...result, provider: result.provider ?? provider.id };
      }
      errors.push(`${provider.id}: empty response`);
    } catch (err) {
      errors.push(`${provider.id}: ${err.message}`);
    }
  }
  throw Object.assign(
    new Error(`All ${capability} providers failed → ${errors.join(" | ")}`),
    { status: 502, attempts: errors },
  );
}

export function describe() {
  return all().map((p) => ({
    id: p.id,
    capabilities: p.capabilities,
    priority: p.priority,
    enabled: typeof p.enabled === "function" ? p.enabled() : true,
  }));
}
