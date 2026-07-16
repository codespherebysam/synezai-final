const DEFAULT_IMAGE_MODELS = [
  "black-forest-labs/FLUX.1-schnell",
  "stabilityai/stable-diffusion-xl-base-1.0",
];

class ImageProviderError extends Error {
  constructor(message, { status = 502, code = "HF_IMAGE_FAILED", details = "" } = {}) {
    super(message);
    this.name = "ImageProviderError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getHuggingFaceToken(env = process.env) {
  return (
    env.HF_API_KEY ||
    env.HUGGINGFACE_API_KEY ||
    env.HF_TOKEN ||
    env.HUGGINGFACE_TOKEN ||
    ""
  ).trim();
}

function getImageModels(env = process.env) {
  const configured = String(env.HF_IMAGE_MODEL || env.HUGGINGFACE_IMAGE_MODEL || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return [...new Set([...configured, ...DEFAULT_IMAGE_MODELS])];
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readProviderError(response) {
  const text = await response.text();
  if (!text) return "";

  try {
    const data = JSON.parse(text);
    return data?.error || data?.message || text;
  } catch {
    return text;
  }
}

function providerErrorForStatus(status, details, model) {
  if (status === 401) {
    return new ImageProviderError(
      "Hugging Face rejected the configured token. Create a token with Inference Providers permission and restart the backend.",
      { status: 401, code: "HF_TOKEN_INVALID", details }
    );
  }

  if (status === 403) {
    return new ImageProviderError(
      `The Hugging Face token cannot access ${model}. Accept the model license or choose another HF_IMAGE_MODEL.`,
      { status: 403, code: "HF_MODEL_FORBIDDEN", details }
    );
  }

  if (status === 429) {
    return new ImageProviderError(
      "Hugging Face image generation is rate-limited or out of provider credits. Wait briefly or check the account quota.",
      { status: 429, code: "HF_RATE_LIMITED", details }
    );
  }

  if (status >= 500) {
    return new ImageProviderError(
      "Hugging Face image generation is temporarily unavailable. Please try again in a moment.",
      { status: 503, code: "HF_TEMPORARILY_UNAVAILABLE", details }
    );
  }

  return new ImageProviderError(
    `Hugging Face could not generate an image with ${model}. Configure a supported HF_IMAGE_MODEL and try again.`,
    { status: 422, code: "HF_MODEL_UNAVAILABLE", details }
  );
}

async function requestImage({
  prompt,
  model,
  token,
  fetchImpl,
  sleep,
  maxRetries,
  timeoutMs,
}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      const modelPath = model.split("/").map(encodeURIComponent).join("/");
      response = await fetchImpl(
        `https://router.huggingface.co/hf-inference/models/${modelPath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "image/*",
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              negative_prompt: "blurry, low quality, distorted, deformed, watermark, text",
            },
            options: { wait_for_model: true, use_cache: false },
          }),
          signal: controller.signal,
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === "AbortError") {
        throw new ImageProviderError(
          "Hugging Face image generation timed out. Try a shorter prompt or another HF_IMAGE_MODEL.",
          { status: 504, code: "HF_IMAGE_TIMEOUT" }
        );
      }
      throw new ImageProviderError(
        "Could not connect to Hugging Face. Check the backend network and try again.",
        { status: 502, code: "HF_NETWORK_ERROR", details: error?.message || "" }
      );
    }

    clearTimeout(timeout);
    const contentType = response.headers.get("content-type") || "";

    if (response.ok && contentType.startsWith("image/")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        throw new ImageProviderError("Hugging Face returned an empty image.", {
          status: 502,
          code: "HF_EMPTY_IMAGE",
        });
      }

      return {
        buffer,
        mimeType: contentType.split(";")[0] || "image/png",
        model,
      };
    }

    if (response.ok && contentType.includes("application/json")) {
      const data = await response.json();
      const imageUrl = data?.image?.url || data?.url || data?.image_url || "";
      if (imageUrl) return { imageUrl, model };
      throw new ImageProviderError("Hugging Face returned JSON without an image.", {
        status: 502,
        code: "HF_INVALID_IMAGE_RESPONSE",
      });
    }

    const details = await readProviderError(response);
    if (response.status === 503 && attempt < maxRetries) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfterSeconds)
        ? Math.min(Math.max(retryAfterSeconds * 1000, 1000), 8000)
        : Math.min(1500 * (attempt + 1), 5000);
      await sleep(delay);
      continue;
    }

    throw providerErrorForStatus(response.status, details, model);
  }

  throw new ImageProviderError("Hugging Face image generation failed.", {
    status: 502,
    code: "HF_IMAGE_FAILED",
  });
}

async function generateHuggingFaceImage({
  prompt,
  env = process.env,
  fetchImpl = global.fetch,
  sleep = wait,
  maxRetries = 2,
  timeoutMs = 90000,
}) {
  const token = getHuggingFaceToken(env);
  if (!token) {
    throw new ImageProviderError(
      "Hugging Face token is not configured. Set HF_API_KEY, HUGGINGFACE_API_KEY, HF_TOKEN, or HUGGINGFACE_TOKEN and restart the backend.",
      { status: 503, code: "HF_TOKEN_MISSING" }
    );
  }

  const models = getImageModels(env);
  let lastError = null;

  for (const model of models) {
    try {
      return await requestImage({
        prompt,
        model,
        token,
        fetchImpl,
        sleep,
        maxRetries,
        timeoutMs,
      });
    } catch (error) {
      lastError = error;
      if (!["HF_MODEL_UNAVAILABLE", "HF_MODEL_FORBIDDEN"].includes(error.code)) throw error;
    }
  }

  throw lastError || new ImageProviderError("No Hugging Face image model was available.");
}

module.exports = {
  ImageProviderError,
  generateHuggingFaceImage,
  getHuggingFaceToken,
  getImageModels,
};
