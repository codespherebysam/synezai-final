/** Tiny structured logger — one place, so every pipeline logs the same way. */

const stamp = () => new Date().toISOString();

function line(level, scope, msg, extra) {
  const base = `${stamp()} [${level}] ${scope}: ${msg}`;
  if (extra === undefined) return base;
  let tail;
  try {
    tail = typeof extra === "string" ? extra : JSON.stringify(extra);
  } catch {
    tail = String(extra);
  }
  return `${base} ${String(tail).slice(0, 600)}`;
}

export const log = {
  info: (scope, msg, extra) => console.log(line("info", scope, msg, extra)),
  warn: (scope, msg, extra) => console.warn(line("warn", scope, msg, extra)),
  error: (scope, msg, extra) => console.error(line("error", scope, msg, extra)),
};

/** Human readable failure text for the client — never a bare 500. */
export function explain(err, fallback = "Unexpected error") {
  const raw = err?.message ?? fallback;
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(raw))
    return `Upstream provider unreachable. ${raw}`;
  if (/aborted|AbortError|timeout/i.test(raw)) return `Provider timed out. ${raw}`;
  return raw;
}
