/**
 * OpenAI-compatible chat provider factory.
 * Groq, OpenRouter, Together, Fireworks, DeepInfra, Ollama, LM Studio and
 * OpenAI itself all speak this dialect — so a new vendor is one line of config.
 */

import { request } from "../core/http.js";
import { withKeys, hasKeys } from "../core/keys.js";
import { toPlainText } from "../core/context.js";

export function openAICompatible({
  id,
  envName,
  baseUrl,
  model,
  visionModel,
  capabilities = ["chat", "stream"],
  priority = 50,
  headers = () => ({}),
}) {
  const url = () => (process.env[`${envName}_BASE_URL`] ?? baseUrl).replace(/\/+$/, "");
  const chatModel = () => process.env[`${envName}_MODEL`] ?? model;
  const seeingModel = () => process.env[`${envName}_VISION_MODEL`] ?? visionModel ?? chatModel();

  async function call(body, { stream = false } = {}) {
    return withKeys(envName, async (key) =>
      request(`${url()}/chat/completions`, {
        method: "POST",
        timeoutMs: stream ? 180_000 : 120_000,
        retries: 0,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...headers(),
        },
        body: JSON.stringify(body),
        raw: stream,
      }),
    );
  }

  async function streamCall(body, onToken) {
    return withKeys(envName, async (key) => {
      const res = await fetch(`${url()}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...headers(),
        },
        body: JSON.stringify({ ...body, stream: true }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw Object.assign(new Error(text.slice(0, 300) || res.statusText), { status: res.status });
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              acc += delta;
              onToken?.(delta);
            }
          } catch {
            /* ignore keep-alives */
          }
        }
      }
      return { content: acc };
    });
  }

  return {
    id,
    priority,
    capabilities,
    enabled: () => hasKeys(envName),

    async chat({ messages, temperature = 0.7, maxTokens }) {
      const res = await call({
        model: chatModel(),
        messages: toPlainText(messages),
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      });
      return { content: res?.choices?.[0]?.message?.content ?? "", model: chatModel() };
    },

    async stream({ messages, onToken, temperature = 0.7 }) {
      return streamCall({ model: chatModel(), messages: toPlainText(messages), temperature }, onToken);
    },

    async vision({ messages, temperature = 0.3 }) {
      const res = await call({ model: seeingModel(), messages, temperature });
      return { content: res?.choices?.[0]?.message?.content ?? "", model: seeingModel() };
    },
  };
}
