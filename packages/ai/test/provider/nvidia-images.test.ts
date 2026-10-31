import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ai, ImageClient, Media } from "../../src/effect.js"
import { Nvidia } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"

const nvidia = Nvidia.configure({ apiKey: "test" })
const json = { headers: { "content-type": "application/json" } }

const artifact = (finishReason: string) =>
  fixedResponse(JSON.stringify({ artifacts: [{ base64: "/9j/4AAQ", finishReason, seed: 1 }] }), json)

describe("NVIDIA GenAI Images", () => {
  it.effect("lowers aspect and resolution to the nearest size the model lists", () =>
    ai.image
      .generate({
        model: nvidia.image("black-forest-labs/flux.1-schnell"),
        prompt: "A red apple",
        aspect: "21:9",
        providerOptions: { steps: 4 },
      })
      .pipe(
        Effect.provide(
          ImageClient.layer.pipe(
            Layer.provide(
              dynamicResponse((input) =>
                Effect.sync(() => {
                  expect(JSON.parse(input.text)).toEqual({ prompt: "A red apple", width: 1344, height: 768, steps: 4 })
                  return input.respond(
                    JSON.stringify({ artifacts: [{ base64: "/9j/4AAQ", finishReason: "SUCCESS", seed: 9 }] }),
                    json,
                  )
                }),
              ),
            ),
          ),
        ),
        Effect.map((response) => expect(response.image.providerMetadata).toEqual({ nvidia: { seed: 9 } })),
      ),
  )

  it.effect("maps CONTENT_FILTERED to a content policy error", () =>
    ai.image.generate({ model: nvidia.image("black-forest-labs/flux.1-dev"), prompt: "test" }).pipe(
      Effect.provide(ImageClient.layer.pipe(Layer.provide(artifact("CONTENT_FILTERED")))),
      Effect.flip,
      Effect.map((error) => expect(error.reason._tag).toBe("ContentPolicy")),
    ),
  )

  it.effect("maps ERROR to a provider failure", () =>
    ai.image.generate({ model: nvidia.image("black-forest-labs/flux.1-dev"), prompt: "test" }).pipe(
      Effect.provide(ImageClient.layer.pipe(Layer.provide(artifact("ERROR")))),
      Effect.flip,
      Effect.map((error) => expect(error.reason._tag).toBe("ProviderInternal")),
    ),
  )

  it.effect("rejects what the hosted API cannot take before sending", () =>
    Effect.gen(function* () {
      const model = nvidia.image("black-forest-labs/flux.2-klein-4b")
      const layer = ImageClient.layer.pipe(Layer.provide(artifact("SUCCESS")))
      const failures = yield* Effect.forEach(
        [
          ai.image.generate({ model, prompt: "test", n: 2 }),
          ai.image.generate({ model, prompt: "test", images: [Media.bytes(new Uint8Array([1]), "image/png")] }),
          ai.image.generate({
            model: nvidia.image("stabilityai/stable-diffusion-3.5-large"),
            prompt: "t",
            aspect: "1:1",
          }),
        ],
        (request) => request.pipe(Effect.provide(layer), Effect.flip),
      )
      expect(failures.map((error) => error.reason._tag)).toEqual([
        "UnsupportedOperation",
        "UnsupportedOperation",
        "UnsupportedOperation",
      ])
    }),
  )
})
