/** Small fetch helper with timeout, retries and rich errors. */

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function request(url, { timeoutMs = 90_000, retries = 1, ...init } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      if (!res.ok) {
        const msg =
          (body && (body.error?.message || body.error || body.message)) ||
          `${res.status} ${res.statusText}`;
        throw new HttpError(res.status, String(msg).slice(0, 400), body);
      }
      return body;
    } catch (err) {
      lastErr = err;
      const retryable = !err.status || err.status >= 500 || err.name === "AbortError";
      if (attempt === retries || !retryable) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const json = (obj) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
