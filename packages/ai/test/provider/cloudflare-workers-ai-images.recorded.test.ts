import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src/effect.js"
import { CloudflareWorkersAI } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

const workers = CloudflareWorkersAI.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
})

const recorded = recordedTests({
  prefix: "cloudflare-workers-ai-images",
  provider: "cloudflare-workers-ai",
  protocol: "cloudflare-workers-ai-images",
  requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
  options: {
    redact: { url: (url) => url.replace(/\/accounts\/[^/]+\/ai\//, "/accounts/{account}/ai/") },
    // Multipart boundaries change on every request, so bodies cannot be matched.
    match: (incoming, recorded) => incoming.method === recorded.method && incoming.url === recorded.url,
  },
})

describe("Cloudflare Workers AI Images recorded", () => {
  recorded.effect("generates a raw binary image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: workers.image("@cf/bytedance/stable-diffusion-xl-lightning"),
        prompt: "A red apple on a wooden table",
        aspect: "1:1",
        resolution: "0.25K",
        providerOptions: { seed: 3, num_steps: 1 },
      })

      // The Run API labels this response image/png, but the bytes are JPEG.
      expect(response.image.mediaType).toBe("image/jpeg")
      expect(dimensions(yield* response.image.bytes())).toEqual({ width: 256, height: 256 })
    }),
  )

  recorded.effect(
    "generates a FLUX.2 image from multipart fields",
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate({
          model: workers.image("@cf/black-forest-labs/flux-2-klein-4b"),
          prompt: "A red apple on a wooden table",
          providerOptions: { width: 64, height: 64, seed: 3, steps: 1 },
        })

        expect(response.image.mediaType).toBe("image/jpeg")
        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 64, height: 64 })
      }),
    { timeout: 60_000 },
  )
})
