import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ai, ImageClient, Media } from "../../src/effect.js"
import { TogetherAI } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "../lib/http.js"

// Together's account settings can block every hosted image model, so this pins the request shape without a cassette.
describe("Together AI Images", () => {
  it.effect("sends width, height and a base64 response format", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* ai.image
        .generate({
          model: TogetherAI.configure({ apiKey: "together-key" }).image("black-forest-labs/FLUX.2-dev"),
          prompt: "A red circle",
          aspect: "16:9",
          resolution: "1K",
          providerOptions: { steps: 4 },
        })
        .pipe(
          Effect.provide(
            ImageClient.layer.pipe(
              Layer.provide(
                dynamicResponse((input) =>
                  observe(calls, input).pipe(
                    Effect.as(json(input, { data: [{ index: 0, type: "b64_json", b64_json: "iVBORw0KGgo=" }] })),
                  ),
                ),
              ),
            ),
          ),
        )

      expect(calls[0].url).toBe("https://api.together.xyz/v1/images/generations")
      expect(calls[0].headers.get("authorization")).toBe("Bearer together-key")
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "black-forest-labs/FLUX.2-dev",
        prompt: "A red circle",
        width: 1360,
        height: 768,
        steps: 4,
        response_format: "base64",
      })
      expect(response.image.mediaType).toBe("image/png")
    }),
  )

  // Together has no `/images/edits`; input images fail before any request instead of as a 404.
  it.effect("rejects input images without sending a request", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* ai.image
        .generate({
          model: TogetherAI.configure({ apiKey: "together-key" }).image("black-forest-labs/FLUX.2-dev"),
          prompt: "A red circle",
          images: [Media.url("https://example.test/a.jpg")],
        })
        .pipe(
          Effect.provide(
            ImageClient.layer.pipe(
              Layer.provide(dynamicResponse((input) => observe(calls, input).pipe(Effect.as(json(input, {}))))),
            ),
          ),
          Effect.flip,
        )

      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(calls).toHaveLength(0)
    }),
  )
})
