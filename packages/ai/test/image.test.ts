import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Image, ImageClient } from "../src"
import { OpenAI } from "../src/providers"
import { it } from "./lib/effect"
import { dynamicResponse } from "./lib/http"

describe("Image", () => {
  it.effect("generates images through the OpenAI Images API", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: OpenAI.configure({
          apiKey: "test",
          baseURL: "https://api.openai.test/v1",
          queryParams: { "api-version": "v1" },
          image: { options: { quality: "medium", outputFormat: "png", background: "opaque" } },
          http: { body: { deployment: "test" }, headers: { "x-default": "yes" } },
        }).image("gpt-image-2"),
        prompt: "A robot tending a rooftop garden",
        options: { n: 2, size: "1024x1024", quality: "high", outputFormat: "jpeg", future_option: true },
        http: {
          body: { output_format: "webp", request_metadata: "value" },
          headers: { "x-request": "yes" },
          query: { trace: "1" },
        },
      })

      expect(response.images).toHaveLength(2)
      expect(response.image?.mediaType).toBe("image/webp")
      expect(response.image?.data).toEqual(Uint8Array.from([1, 2, 3]))
      expect(response.image?.providerMetadata).toEqual({ openai: { revisedPrompt: "A precise robot" } })
      expect(response.usage?.totalTokens).toBe(12)
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe("https://api.openai.test/v1/images/generations?api-version=v1&trace=1")
                expect(request.headers.get("authorization")).toBe("Bearer test")
                expect(request.headers.get("x-default")).toBe("yes")
                expect(request.headers.get("x-request")).toBe("yes")
                expect(JSON.parse(input.text)).toEqual({
                  model: "gpt-image-2",
                  prompt: "A robot tending a rooftop garden",
                  n: 2,
                  size: "1024x1024",
                  quality: "high",
                  background: "opaque",
                  output_format: "webp",
                  future_option: true,
                  deployment: "test",
                  request_metadata: "value",
                })
                return input.respond(
                  JSON.stringify({
                    data: [{ b64_json: "AQID", revised_prompt: "A precise robot" }, { b64_json: "BAUG" }],
                    output_format: "webp",
                    usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12 },
                  }),
                  { headers: { "content-type": "application/json" } },
                )
              }),
            ),
          ),
        ),
      ),
    ),
  )
})
