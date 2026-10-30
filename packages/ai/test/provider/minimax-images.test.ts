import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { Image, ImageClient, Media } from "../../src/effect.js"
import type { ImageRequestInput } from "../../src/image.js"
import { MiniMax } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"

const minimax = MiniMax.configure({ apiKey: "test" })
const imageResponse = JSON.stringify({ data: { image_urls: ["https://cdn.minimax.test/a.jpeg"] } })

/** The JSON body MiniMax receives for a request. */
const sent = (
  request: Omit<ImageRequestInput<ReturnType<typeof minimax.image>>, "model" | "prompt">,
  model = "image-01",
) =>
  Effect.gen(function* () {
    let body: unknown
    yield* Image.generate({ model: minimax.image(model), prompt: "test", ...request }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              body = JSON.parse(input.text)
              return Effect.succeed(input.respond(imageResponse, { headers: { "content-type": "application/json" } }))
            }),
          ),
        ),
      ),
    )
    return body
  })

const failure = (
  request: Omit<ImageRequestInput<ReturnType<typeof minimax.image>>, "model" | "prompt">,
  model = "image-01",
  response = imageResponse,
) =>
  Image.generate({ model: minimax.image(model), prompt: "test", ...request }).pipe(
    Effect.provide(
      ImageClient.layer.pipe(
        Layer.provide(fixedResponse(response, { headers: { "content-type": "application/json" } })),
      ),
    ),
    Effect.flip,
  )

describe("MiniMax Images", () => {
  it.effect("generates through the MiniMax image API", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: MiniMax.configure({
          apiKey: "test",
          baseURL: "https://api.minimax.test/v1",
          headers: { "x-default": "yes" },
          http: { body: { configured: true } },
        }).image("image-01"),
        prompt: "A girl stands by the library window",
        n: 2,
        aspect: "16:9",
        images: [Media.url("https://example.test/face.jpg")],
        providerOptions: { responseFormat: "url", response_format: "base64", promptOptimizer: true, seed: 7 },
        http: { headers: { "x-request": "yes" }, body: { future_option: "http" } },
      })

      expect(response.images).toHaveLength(2)
      expect(yield* response.images[0].bytes()).toEqual(Uint8Array.from([1, 2, 3]))
      // MiniMax documents that output URLs expire after 24 hours; the test clock starts at 0.
      expect(response.images[1].source).toEqual({
        type: "url",
        url: "https://cdn.minimax.test/b.jpeg",
        expiresAt: 24 * 60 * 60 * 1000,
      })
      expect(response.providerMetadata).toEqual({ minimax: { id: "trace-1", successCount: 2, failedCount: 0 } })
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe("https://api.minimax.test/v1/image_generation")
                expect(request.headers.get("authorization")).toBe("Bearer test")
                expect(request.headers.get("x-default")).toBe("yes")
                expect(request.headers.get("x-request")).toBe("yes")
                expect(JSON.parse(input.text)).toEqual({
                  model: "image-01",
                  prompt: "A girl stands by the library window",
                  subject_reference: [{ type: "character", image_file: "https://example.test/face.jpg" }],
                  n: 2,
                  aspect_ratio: "16:9",
                  response_format: "base64",
                  prompt_optimizer: true,
                  seed: 7,
                  configured: true,
                  future_option: "http",
                })
                return input.respond(
                  JSON.stringify({
                    id: "trace-1",
                    data: { image_base64: ["AQID"], image_urls: ["https://cdn.minimax.test/b.jpeg"] },
                    metadata: { success_count: 2, failed_count: 0 },
                    base_resp: { status_code: 0, status_msg: "success" },
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

  it.effect("asks for base64 by default and keeps an explicit url format", () =>
    Effect.gen(function* () {
      expect(yield* sent({})).toEqual({ model: "image-01", prompt: "test", response_format: "base64" })
      expect(yield* sent({ providerOptions: { responseFormat: "url" } })).toMatchObject({ response_format: "url" })
    }),
  )

  it.effect("sends inline subject references as data URLs", () =>
    Effect.gen(function* () {
      expect(yield* sent({ images: [Media.bytes(Uint8Array.from([1, 2, 3]), "image/png")] })).toMatchObject({
        subject_reference: [{ type: "character", image_file: "data:image/png;base64,AQID" }],
      })
    }),
  )

  it.effect("uses aspect_ratio presets for about 1K and width and height otherwise", () =>
    Effect.gen(function* () {
      const cases = [
        [{}, {}],
        [{ aspect: "16:9" }, { aspect_ratio: "16:9" }],
        [{ aspect: "21:9", resolution: "1K" }, { aspect_ratio: "21:9" }],
        [{ resolution: "1K" }, { aspect_ratio: "1:1" }],
        [
          { aspect: "16:9", resolution: "2K" },
          { width: 2048, height: 1152 },
        ],
        [{ resolution: "2K" }, { width: 2048, height: 2048 }],
        [{ aspect: "5:4" }, { width: 1144, height: 912 }],
      ] as const
      yield* Effect.forEach(cases, ([request, expected]) =>
        sent(request).pipe(
          Effect.tap((body) =>
            Effect.sync(() => {
              const sizing = Object.fromEntries(
                Object.entries(body as Record<string, unknown>).filter(([key]) =>
                  ["aspect_ratio", "width", "height"].includes(key),
                ),
              )
              expect(sizing).toEqual(expected)
            }),
          ),
        ),
      )
    }),
  )

  it.effect("fails with the closest size when MiniMax can't honor the shape", () =>
    Effect.gen(function* () {
      const tooLarge = yield* failure({ aspect: "16:9", resolution: "4K" })
      expect(tooLarge.reason._tag).toBe("UnsupportedOperation")
      expect(tooLarge.message).toContain("closest size it takes is 2048x1152 (16:9)")

      const live = yield* failure({ aspect: "5:4" }, "image-01-live")
      expect(live.reason._tag).toBe("UnsupportedOperation")
      expect(live.message).toContain("image-01-live can't render 5:4; the closest size it takes is 1152x864 (4:3)")

      const liveWide = yield* failure({ aspect: "21:9" }, "image-01-live")
      expect(liveWide.message).toContain("the closest size it takes is 1280x720 (16:9)")

      const liveLarge = yield* failure({ aspect: "16:9", resolution: "2K" }, "image-01-live")
      expect(liveLarge.message).toContain("the closest size it takes is 1280x720 (16:9)")
    }),
  )

  it.effect("keeps presets on image-01-live", () =>
    Effect.gen(function* () {
      expect(yield* sent({ aspect: "9:16" }, "image-01-live")).toMatchObject({ aspect_ratio: "9:16" })
    }),
  )

  it.effect("rejects requests MiniMax can't take", () =>
    Effect.gen(function* () {
      const images = yield* failure({
        images: [Media.url("https://example.test/a.jpg"), Media.url("https://example.test/b.jpg")],
      })
      expect(images.reason._tag).toBe("UnsupportedOperation")

      const both = yield* failure({ aspect: "16:9", providerOptions: { width: 1024, height: 512 } })
      expect(both.reason._tag).toBe("InvalidRequest")

      expect(yield* sent({ providerOptions: { width: 1024, height: 512 } })).toMatchObject({ width: 1024, height: 512 })
    }),
  )

  it.effect("maps MiniMax status codes", () =>
    Effect.gen(function* () {
      const cases = [
        [1002, "RateLimit"],
        [1004, "Authentication"],
        [1008, "QuotaExceeded"],
        [1026, "ContentPolicy"],
        [2013, "InvalidRequest"],
        [9999, "ProviderInternal"],
      ] as const
      yield* Effect.forEach(cases, ([code, tag]) =>
        failure(
          {},
          "image-01",
          JSON.stringify({ data: null, base_resp: { status_code: code, status_msg: "message" } }),
        ).pipe(Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe(tag)))),
      )

      const blocked = yield* failure(
        {},
        "image-01",
        JSON.stringify({
          data: { image_urls: [] },
          metadata: { success_count: "0", failed_count: "1" },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
      )
      expect(blocked.reason._tag).toBe("ContentPolicy")

      const empty = yield* failure({}, "image-01", JSON.stringify({ data: {}, base_resp: { status_code: 0 } }))
      expect(empty.reason._tag).toBe("InvalidProviderOutput")
    }),
  )
})
