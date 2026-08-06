/**
 * API key pool.
 * Any provider can declare N keys via a comma separated env var
 * (GROQ_API_KEYS=a,b,c) or the classic single form (GROQ_API_KEY=a).
 * Keys are rotated round-robin and a key that returns 401/429 is
 * cooled down automatically, so one exhausted key never breaks a provider.
 */

const pools = new Map();

function read(name) {
  const many = process.env[`${name}_KEYS`] ?? process.env[`${name}_API_KEYS`] ?? "";
  const one = process.env[`${name}_API_KEY`] ?? process.env[name] ?? "";
  return [...many.split(","), one]
    .map((k) => k.trim())
    .filter(Boolean)
    .filter((k, i, a) => a.indexOf(k) === i);
}

export function keyPool(name) {
  if (!pools.has(name)) {
    pools.set(name, { keys: read(name), cursor: 0, cooldown: new Map() });
  }
  return pools.get(name);
}

export function hasKeys(name) {
  return keyPool(name).keys.length > 0;
}

export function keyCount(name) {
  return keyPool(name).keys.length;
}

/** Next usable key, skipping keys that are cooling down. */
export function nextKey(name) {
  const pool = keyPool(name);
  const n = pool.keys.length;
  if (!n) return null;
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const key = pool.keys[pool.cursor % n];
    pool.cursor = (pool.cursor + 1) % n;
    const until = pool.cooldown.get(key) ?? 0;
    if (until <= now) return key;
  }
  return pool.keys[0]; // all cooling down — try anyway
}

export function penalise(name, key, ms = 10 * 60_000) {
  if (!key) return;
  keyPool(name).cooldown.set(key, Date.now() + ms);
}

/** Run `fn(key)` against every key in the pool until one succeeds. */
export async function withKeys(name, fn) {
  const pool = keyPool(name);
  if (!pool.keys.length) throw new Error(`${name}: no API key configured`);
  let lastErr;
  for (let i = 0; i < pool.keys.length; i++) {
    const key = nextKey(name);
    try {
      return await fn(key);
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? 0;
      if (status === 401 || status === 403) penalise(name, key, 60 * 60_000);
      else if (status === 429) penalise(name, key, 10 * 60_000);
      else if (status && status < 500) throw err; // real request error, not key related
    }
  }
  throw lastErr ?? new Error(`${name}: all keys failed`);
}
