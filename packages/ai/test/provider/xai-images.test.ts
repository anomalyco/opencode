import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Image, ImageClient } from "../../src"
import { XAI } from "../../src/providers"
import { Auth } from "../../src/route"
import { it } from "../lib/effect"
import { dynamicResponse } from "../lib/http"

describe("xAI Images", () => {
  it.effect("generates through the OpenAI-compatible Images API", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: XAI.configure({
          apiKey: "test",
          baseURL: "https://api.xai.test/v1",
          http: { body: { configured: true }, headers: { "x-default": "yes" } },
        }).image("grok-imagine-image"),
        prompt: "A robot tending a rooftop garden",
        options: {
          n: 2,
          aspectRatio: "16:9",
          aspect_ratio: "4:3",
          resolution: "1k",
          responseFormat: "url",
          response_format: "b64_json",
          future_option: true,
        },
        http: {
          body: { resolution: "2k", future_option: "http" },
          headers: { "x-request": "yes" },
          query: { trace: "1" },
        },
      })

      expect(response.images).toHaveLength(2)
      expect(response.image?.mediaType).toBe("image/jpeg")
      expect(response.image?.data).toEqual(Uint8Array.from([1, 2, 3]))
      expect(response.images[1]?.mediaType).toBe("application/octet-stream")
      expect(response.images[1]?.data).toBe("https://api.xai.test/image.jpg")
      expect(response.usage?.providerMetadata).toEqual({ xai: { num_images: 2 } })
      expect(response.providerMetadata).toEqual({ xai: { usage: { num_images: 2 } } })
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe("https://api.xai.test/v1/images/generations?trace=1")
                expect(request.headers.get("authorization")).toBe("Bearer test")
                expect(request.headers.get("x-default")).toBe("yes")
                expect(request.headers.get("x-request")).toBe("yes")
                expect(JSON.parse(input.text)).toEqual({
                  model: "grok-imagine-image",
                  prompt: "A robot tending a rooftop garden",
                  n: 2,
                  aspect_ratio: "4:3",
                  resolution: "2k",
                  response_format: "b64_json",
                  future_option: "http",
                  configured: true,
                })
                return input.respond(
                  JSON.stringify({
                    data: [
                      { b64_json: "AQID", url: null, mime_type: "image/jpeg" },
                      { b64_json: null, url: "https://api.xai.test/image.jpg", mime_type: null },
                    ],
                    usage: { num_images: 2 },
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

  it.effect("supports request-level custom auth", () =>
    Image.generate({
      model: XAI.configure({
        baseURL: "https://api.xai.test/v1",
        auth: Auth.custom((input) =>
          Effect.succeed(Headers.set(input.headers, "x-custom-auth", new URL(input.url).hostname)),
        ),
      }).image("grok-imagine-image"),
      prompt: "A robot tending a rooftop garden",
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.headers.get("x-custom-auth")).toBe("api.xai.test")
                return input.respond(JSON.stringify({ data: [{ b64_json: "AQID", mime_type: "image/png" }] }), {
                  headers: { "content-type": "application/json" },
                })
              }),
            ),
          ),
        ),
      ),
    ),
  )
})
