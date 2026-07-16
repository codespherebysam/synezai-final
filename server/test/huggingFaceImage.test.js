const assert = require("node:assert/strict");
const test = require("node:test");
const {
  generateHuggingFaceImage,
  getHuggingFaceToken,
} = require("../lib/huggingFaceImage");

test("accepts supported Hugging Face token aliases", () => {
  assert.equal(getHuggingFaceToken({ HUGGINGFACE_API_KEY: "alias-token" }), "alias-token");
  assert.equal(getHuggingFaceToken({ HF_TOKEN: "hf-token" }), "hf-token");
});

test("returns a binary image with the configured model", async () => {
  let request;
  const generated = await generateHuggingFaceImage({
    prompt: "a friendly robot",
    env: {
      HUGGINGFACE_TOKEN: "test-token",
      HF_IMAGE_MODEL: "owner/image-model",
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    },
  });

  assert.equal(generated.model, "owner/image-model");
  assert.equal(generated.mimeType, "image/png");
  assert.deepEqual([...generated.buffer], [1, 2, 3]);
  assert.match(request.url, /owner\/image-model$/);
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
});

test("retries temporary 503 responses before succeeding", async () => {
  let calls = 0;
  let sleeps = 0;

  const generated = await generateHuggingFaceImage({
    prompt: "mountain sunrise",
    env: { HF_API_KEY: "test-token", HF_IMAGE_MODEL: "owner/image-model" },
    sleep: async () => {
      sleeps += 1;
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "Model is loading" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(Uint8Array.from([9]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
  assert.equal(generated.mimeType, "image/webp");
});

test("returns actionable diagnostics when no token is configured", async () => {
  await assert.rejects(
    generateHuggingFaceImage({ prompt: "test", env: {} }),
    (error) =>
      error.code === "HF_TOKEN_MISSING" &&
      error.status === 503 &&
      /HF_API_KEY/.test(error.message)
  );
});
