/**
 * Shared conversation context.
 * Every provider sees the same normalised message list, so switching or
 * falling back between providers never loses history. Sessions are kept in
 * memory with a TTL (swap `store` for Redis/Postgres without touching routes).
 */

const TTL_MS = Number(process.env.CONTEXT_TTL_MS ?? 6 * 60 * 60_000);
const MAX_TURNS = Number(process.env.CONTEXT_MAX_TURNS ?? 40);
const store = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of store) if (now - s.updatedAt > TTL_MS) store.delete(id);
}, 15 * 60_000).unref?.();

export function getSession(id) {
  if (!id) return null;
  const s = store.get(id) ?? { id, messages: [], meta: {}, updatedAt: Date.now() };
  store.set(id, s);
  return s;
}

export function remember(id, messages) {
  if (!id) return;
  const s = getSession(id);
  s.messages = [...s.messages, ...messages].slice(-MAX_TURNS * 2);
  s.updatedAt = Date.now();
}

/** Normalise anything a client sends into a clean OpenAI-style message list. */
export function buildMessages({ sessionId, system, messages, history, prompt, message, context }) {
  const out = [];
  const sys = [system, context].filter(Boolean).join("\n\n");
  if (sys) out.push({ role: "system", content: sys });

  const prior = getSession(sessionId)?.messages ?? [];
  const supplied = Array.isArray(messages)
    ? messages.filter((m) => m && m.role !== "system")
    : Array.isArray(history)
      ? history
      : [];

  const merged = supplied.length ? supplied : prior;
  for (const m of merged) {
    if (!m?.content && !Array.isArray(m?.content)) continue;
    out.push({ role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user", content: m.content });
  }

  const last = out[out.length - 1];
  const userText = prompt ?? message;
  const alreadyThere =
    last && last.role === "user" && typeof last.content === "string" && last.content === userText;
  if (userText && !alreadyThere) out.push({ role: "user", content: userText });

  return out;
}

/** Flatten multimodal content down to text for providers without vision. */
export function toPlainText(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: Array.isArray(m.content)
      ? m.content
          .map((p) => (p.type === "text" ? p.text : p.type === "image_url" ? "[image attached]" : ""))
          .filter(Boolean)
          .join("\n")
      : m.content,
  }));
}
