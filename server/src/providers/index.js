/**
 * Provider index — the ONLY file you touch to add a vendor.
 * Drop a provider module in this folder, import it, register it. Done.
 */

import { register } from "../core/registry.js";
import { openAICompatible } from "./openai-compatible.js";
import { gemini } from "./gemini.js";
import { huggingface } from "./huggingface.js";
import { serper, wikipedia } from "./serper.js";
import { elevenlabs, openaiSpeech, systemVoice } from "./speech.js";

export function registerProviders() {
  // ---- LLM / vision (OpenAI-dialect vendors are pure config) ----
  register(
    openAICompatible({
      id: "groq",
      envName: "GROQ",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      visionModel: "meta-llama/llama-4-scout-17b-16e-instruct",
      capabilities: ["chat", "stream", "vision"],
      priority: 10,
    }),
  );

  register(gemini);

  register(
    openAICompatible({
      id: "openrouter",
      envName: "OPENROUTER",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta-llama/llama-3.3-70b-instruct",
      visionModel: "google/gemini-2.0-flash-001",
      capabilities: ["chat", "stream", "vision"],
      priority: 30,
      headers: () => ({
        "HTTP-Referer": process.env.APP_URL ?? "https://synezai.lovable.app",
        "X-Title": "SYNEZ AI",
      }),
    }),
  );

  register(
    openAICompatible({
      id: "openai",
      envName: "OPENAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      visionModel: "gpt-4o-mini",
      capabilities: ["chat", "stream", "vision"],
      priority: 40,
    }),
  );

  register(
    openAICompatible({
      id: "together",
      envName: "TOGETHER",
      baseUrl: "https://api.together.xyz/v1",
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      capabilities: ["chat", "stream"],
      priority: 60,
    }),
  );

  // ---- Image ----
  register(huggingface);

  // ---- Search ----
  register(serper);
  register(wikipedia);

  // ---- Speech ----
  register(elevenlabs);
  register(openaiSpeech);
  register(systemVoice);
}
