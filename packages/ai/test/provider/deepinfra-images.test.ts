import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ai, ImageClient } from "../../src/effect.js"
import { DeepInfra } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "../lib/http.js"

// No DeepInfra key to record with, so this pins the request shape without a cassette.
describe("DeepInfra Images", () => {
  it.effect("sends a pixel size to the OpenAI-compatible route under a configured root", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* ai.image
        .generate({
          model: DeepInfra.configure({ apiKey: "deepinfra-key", baseURL: "https://api.deepinfra.test/v1" }).image(
            "black-forest-labs/FLUX-1-schnell",
          ),
          prompt: "A red circle",
          aspect: "16:9",
          resolution: "1K",
        })
        .pipe(
          Effect.provide(
            ImageClient.layer.pipe(
              Layer.provide(
                dynamicResponse((input) =>
                  observe(calls, input).pipe(Effect.as(json(input, { data: [{ b64_json: "iVBORw0KGgo=" }] }))),
                ),
              ),
            ),
          ),
        )

      expect(calls[0].url).toBe("https://api.deepinfra.test/v1/openai/images/generations")
      expect(calls[0].headers.get("authorization")).toBe("Bearer deepinfra-key")
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "black-forest-labs/FLUX-1-schnell",
        prompt: "A red circle",
        size: "1360x768",
      })
      expect(response.image.mediaType).toBe("image/png")
    }),
  )
})
