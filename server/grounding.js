/** Speech providers — TTS with graceful fallback to a browser-side signal. */

import { hasKeys, withKeys } from "../core/keys.js";

export const elevenlabs = {
  id: "elevenlabs",
  priority: 10,
  capabilities: ["speech"],
  enabled: () => hasKeys("ELEVENLABS"),

  async speech({ text, voice }) {
    const voiceId = voice || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    return withKeys("ELEVENLABS", async (key) => {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, 4000),
          model_id: process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw Object.assign(new Error(t.slice(0, 200) || res.statusText), { status: res.status });
      }
      return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
    });
  },
};

export const openaiSpeech = {
  id: "openai-speech",
  priority: 20,
  capabilities: ["speech"],
  enabled: () => hasKeys("OPENAI"),

  async speech({ text, voice }) {
    return withKeys("OPENAI", async (key) => {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
          voice: voice || "alloy",
          input: text.slice(0, 4000),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw Object.assign(new Error(t.slice(0, 200) || res.statusText), { status: res.status });
      }
      return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
    });
  },
};

/**
 * System build voice — always available. Emits no audio; the client falls
 * back to the on-device SpeechSynthesis engine, so TTS never hard-fails
 * when a paid voice API runs out of credit.
 */
export const systemVoice = {
  id: "system-voice",
  priority: 99,
  capabilities: ["speech"],
  enabled: () => true,
  async speech({ text }) {
    return { audio: null, mime: "application/json", fallback: "browser", text };
  },
};
