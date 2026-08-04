/** Central API routing — one place, capability driven, vendor agnostic. */

import { Router } from "express";
import multer from "multer";
import { run, describe, candidates } from "../core/registry.js";
import { buildMessages, remember } from "../core/context.js";
import { detectIntent, planFor, personaFor, nowContext } from "../core/router.js";
import { extractText } from "../services/documents.js";
import { groundedContext } from "../services/grounding.js";
import { log, explain } from "../core/log.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
export const api = Router();

const fail = (res, err, scope = "api") => {
  log.error(scope, "request failed", err?.stack ?? err?.message);
  const message = explain(err);
  res.status(err?.status ?? 500).json({ error: message, message, attempts: err?.attempts });
};

/** Accept every image field shape the clients send. */
function collectImages(body = {}) {
  const out = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  push(body.image);
  push(body.image_url);
  for (const key of ["images", "image_urls", "imageUrls"]) {
    if (Array.isArray(body[key])) body[key].forEach((v) => push(typeof v === "string" ? v : v?.url));
  }
  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      if (!Array.isArray(m?.content)) continue;
      for (const part of m.content) if (part?.type === "image_url") push(part.image_url?.url);
    }
  }
  return [...new Set(out)];
}

/* ------------------------------- health ------------------------------- */

api.get("/health", (_req, res) =>
  res.json({ ok: true, service: "synezai-backend", version: "2.0.0", time: new Date().toISOString() }),
);

api.get("/providers", (_req, res) =>
  res.json({
    providers: describe(),
    routing: Object.fromEntries(
      ["chat", "stream", "vision", "image", "search", "speech"].map((c) => [
        c,
        candidates(c).map((p) => p.id),
      ]),
    ),
  }),
);

/* ------------------------------ orchestrate ---------------------------- */
/** One endpoint that picks the whole pipeline automatically. */
api.post("/orchestrate", async (req, res) => {
  try {
    const {
      prompt = "",
      message,
      sessionId,
      documents = [],
      preferred = [],
      system,
      context: clientContext,
      allowSearch,
      hasAttachments = false,
    } = req.body ?? {};
    const text = prompt || message || "";
    const images = collectImages(req.body ?? {});
    const attached = hasAttachments || images.length > 0 || documents.length > 0;
    const intent = detectIntent({
      prompt: text,
      hasImage: images.length > 0,
      docCount: documents.length,
    });
    const plan = planFor(intent);
    // Uploaded files are the source of truth: never search the web for them.
    // Otherwise honour the client's explicit decision when it sends one.
    const shouldSearch = attached
      ? false
      : typeof allowSearch === "boolean"
        ? allowSearch
        : plan.search;

    if (plan.capability === "image") {
      const out = await run("image", { prompt: text }, { preferred });
      return res.json({ intent, provider: out.provider, images: out.images });
    }

    const { context, sources } = shouldSearch
      ? await groundedContext(text)
      : { context: "", sources: [] };

    const docContext = documents.length
      ? documents
          .map((d, i) => `--- DOCUMENT ${i + 1}: ${d.name ?? "file"} ---\n${String(d.text ?? "").slice(0, 12000)}`)
          .join("\n\n")
      : "";

    const messages = buildMessages({
      sessionId,
      system: system || personaFor(intent),
      context: [nowContext(), clientContext, context, docContext].filter(Boolean).join("\n\n"),
      messages: req.body.messages,
      prompt: text,
    });

    if (images.length) {
      const last = messages[messages.length - 1];
      last.content = [
        { type: "text", text: text || "Analyse the attached image(s)." },
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
      ];
    }

    const capability = images.length ? "vision" : "chat";
    const out = await run(capability, { messages }, { preferred });

    remember(sessionId, [
      { role: "user", content: text },
      { role: "assistant", content: out.content },
    ]);

    res.json({
      intent,
      provider: out.provider,
      model: out.model,
      content: out.content,
      sources: shouldSearch ? sources : [],
    });
  } catch (err) {
    fail(res, err, "orchestrate");
  }
});

/* --------------------------------- chat -------------------------------- */

api.post("/chat", async (req, res) => {
  try {
    const { prompt, message, system, sessionId, preferred = [] } = req.body ?? {};
    const messages = buildMessages({
      sessionId,
      system: system ?? personaFor("chat"),
      context: nowContext(),
      messages: req.body.messages,
      prompt: prompt ?? message,
    });
    const out = await run("chat", { messages }, { preferred });
    remember(sessionId, [
      { role: "user", content: prompt ?? message ?? "" },
      { role: "assistant", content: out.content },
    ]);
    res.json({ content: out.content, reply: out.content, provider: out.provider, model: out.model });
  } catch (err) {
    fail(res, err);
  }
});

/** SSE streaming. Falls back to a single chunk if no streaming provider works. */
api.post("/chat-stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const { prompt, message, system, sessionId, preferred = [] } = req.body ?? {};
    const messages = buildMessages({
      sessionId,
      system: system ?? personaFor("chat"),
      context: nowContext(),
      messages: req.body.messages,
      prompt: prompt ?? message,
    });

    let out;
    try {
      out = await run("stream", { messages, onToken: (delta) => send({ delta }) }, { preferred });
    } catch {
      out = await run("chat", { messages }, { preferred });
      send({ delta: out.content });
    }
    remember(sessionId, [
      { role: "user", content: prompt ?? message ?? "" },
      { role: "assistant", content: out.content },
    ]);
    send({ done: true, provider: out.provider });
  } catch (err) {
    send({ error: err.message });
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

/* -------------------------------- vision ------------------------------- */

api.post("/vision", async (req, res) => {
  try {
    const body = req.body ?? {};
    const prompt = body.prompt || body.message || body.question || "Analyse this image.";
    const { sessionId, preferred = [] } = body;
    const images = collectImages(body);
    if (!images.length)
      return res.status(400).json({ error: "No image received. Send images[] as data URLs or https URLs." });
    log.info("vision", `analysing ${images.length} image(s)`);
    const messages = buildMessages({ sessionId, system: personaFor("vision"), prompt });
    messages[messages.length - 1].content = [
      { type: "text", text: prompt },
      ...images.map((url) => ({ type: "image_url", image_url: { url } })),
    ];
    const out = await run("vision", { messages }, { preferred });
    res.json({ content: out.content, answer: out.content, provider: out.provider, model: out.model });
  } catch (err) {
    fail(res, err, "vision");
  }
});

/* -------------------------------- image -------------------------------- */

const imageHandler = async (req, res) => {
  try {
    const prompt = req.body?.prompt ?? req.body?.text ?? req.query?.prompt;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    log.info("image", `generating: ${String(prompt).slice(0, 120)}`);
    const out = await run("image", { prompt }, { preferred: req.body?.preferred ?? [] });
    if (!out.images?.length) throw new Error("Image provider returned no image data.");
    res.json({
      images: out.images,
      image: out.images[0],
      url: out.images[0],
      data: out.images[0],
      provider: out.provider,
      model: out.model,
    });
  } catch (err) {
    fail(res, err, "image");
  }
};
api.post("/generate-image", imageHandler);
api.post("/image", imageHandler);

/* -------------------------------- search ------------------------------- */

const searchHandler = async (req, res) => {
  try {
    const query = req.body?.query ?? req.body?.q ?? req.query?.q;
    if (!query) return res.status(400).json({ error: "query is required" });
    const out = await run("search", { query, num: Number(req.body?.num ?? 6) });
    res.json({ query, provider: out.provider, results: out.results, answer: out.answer ?? "", fetchedAt: out.fetchedAt });
  } catch (err) {
    fail(res, err);
  }
};
api.post("/web-search", searchHandler);
api.post("/search", searchHandler);
api.post("/serper", searchHandler);

/* ------------------------------ documents ------------------------------ */

api.post("/read-document", upload.any(), async (req, res) => {
  try {
    const file = req.file ?? req.files?.[0];
    if (!file)
      return res
        .status(400)
        .json({ error: "No file received. Upload it as multipart/form-data." });
    const text = await extractText(file);
    res.json({ name: file.originalname, text, content: text, chars: text.length });
  } catch (err) {
    fail(res, err, "read-document");
  }
});

/* -------------------------------- speech ------------------------------- */

api.post("/tts", async (req, res) => {
  try {
    const { text, voice } = req.body ?? {};
    if (!text) return res.status(400).json({ error: "text is required" });
    const out = await run("speech", { text, voice });
    if (!out.audio) return res.json({ fallback: "browser", provider: out.provider, text });
    res.setHeader("Content-Type", out.mime ?? "audio/mpeg");
    res.setHeader("X-Provider", out.provider);
    res.send(out.audio);
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------ coding agent ---------------------------- */

api.post("/coding-agent", async (req, res) => {
  try {
    const { prompt, command, sessionId } = req.body ?? {};
    const task = prompt ?? command ?? "";
    const messages = buildMessages({
      sessionId,
      system: personaFor("code"),
      context: nowContext(),
      prompt: task,
    });
    const out = await run("chat", { messages, temperature: 0.2 });
    res.json({ output: out.content, content: out.content, provider: out.provider });
  } catch (err) {
    fail(res, err);
  }
});
