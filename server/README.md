# SYNEZ AI Backend v2 — modular provider architecture

Plug-and-play. Adding a vendor never touches routes or core logic.

## Add a provider
1. Create `src/providers/<name>.js` exporting `{ id, capabilities, priority, enabled(), chat/vision/image/search/speech }`.
   OpenAI-dialect vendors need no code — just a `openAICompatible({...})` config entry.
2. Register it in `src/providers/index.js`. Done.

Capabilities: `chat`, `stream`, `vision`, `image`, `search`, `speech`.
Selection: caller `preferred[]` → `PROVIDER_ORDER_<CAP>` env → declared priority. Any failure falls through to the next provider automatically.

## Env
```
PORT=10000
GROQ_API_KEYS=k1,k2,k3,k4,k5
GEMINI_API_KEYS=k1,k2,k3,k4,k5
OPENROUTER_API_KEYS=k1
HF_API_KEYS=k1,k2,k3
SERPER_API_KEYS=k1,k2,k3,k4,k5
# optional
OPENAI_API_KEYS=
ELEVENLABS_API_KEYS=
PROVIDER_ORDER_CHAT=groq,gemini,openrouter
DISABLED_PROVIDERS=
CORS_ORIGIN=*
```
Multi-key pools rotate round-robin; 429/401 keys cool down automatically.

## Endpoints (unchanged contract)
`/health` `/providers` `/orchestrate` `/chat` `/chat-stream` (SSE) `/vision` `/generate-image` `/web-search` `/read-document` `/tts` `/coding-agent` — also mirrored under `/api/*`.

## Render
Build `npm install`, start `npm start`. Node >= 18.17.

## New environment variables

```
APP_NAME=SYNEZ AI
APP_CREATOR=Sameer Khan
DAILY_IMAGE_LIMIT=3
# Firestore quota storage (optional — falls back to in-memory when absent)
FIREBASE_SERVICE_ACCOUNT={"project_id":"chatbot-d73e2", ...}   # raw JSON or base64
FIREBASE_PROJECT_ID=chatbot-d73e2
IMAGE_QUOTA_COLLECTION=image_quota
```

- `/generate-image` enforces 3 images per Firebase UID per UTC day and returns `{ quota: { limit, used, remaining } }`.
- `/vision` and `/orchestrate` accept multipart/form-data image uploads (real bytes) as well as base64 data URLs.
