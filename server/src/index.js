import express from "express";
import cors from "cors";
import { registerProviders } from "./providers/index.js";
import { api } from "./routes/api.js";
import { describe } from "./core/registry.js";
import { keyCount } from "./core/keys.js";

registerProviders();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

app.use("/", api);
app.use("/api", api); // same surface under /api for older clients

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const port = process.env.PORT ?? 10000;
app.listen(port, () => {
  for (const name of ["GROQ", "GEMINI", "OPENROUTER", "HF", "SERPER", "OPENAI", "ELEVENLABS"]) {
    const n = keyCount(name);
    if (n) console.log(`${name} keys loaded ✅ (${n})`);
  }
  console.log(
    "Providers:",
    describe()
      .filter((p) => p.enabled)
      .map((p) => p.id)
      .join(", "),
  );
  console.log(`SYNEZ AI backend listening on :${port}`);
});
