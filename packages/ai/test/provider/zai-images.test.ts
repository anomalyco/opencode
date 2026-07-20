import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Image, ImageClient } from "../../src"
import { ZAI } from "../../src/providers"
import { it } from "../lib/effect"
import { dynamicResponse, fixedResponse } from "../lib/http"

describe("Z.ai Images", () => {
  it.effect("generates through the Z.ai Images API", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: ZAI.configure({
          apiKey: "test",
          baseURL: "https://api.z.ai.test/api/paas/v4",
          headers: { "x-default": "yes" },
          http: { body: { configured: true, quality: "configured" }, query: { trace: "default" } },
        }).image("glm-image"),
        prompt: "A red circle on a white background",
        options: {
          quality: "hd",
          userID: "alias-user",
          user_id: "raw-user",
          future_option: true,
        },
        http: {
          headers: { "x-request": "yes" },
          query: { trace: "request" },
          body: { quality: "final", user_id: "final-user" },
        },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("application/octet-stream")
      expect(response.image?.data).toBe("https://cdn.z.ai/generated.png")
      expect(response.providerMetadata).toEqual({
        zai: {
          created: 1_760_335_349,
          id: "generation-1",
          requestID: "request-1",
          contentFilter: [{ role: "future-role", level: 4.5 }],
        },
      })
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe("https://api.z.ai.test/api/paas/v4/images/generations?trace=request")
                expect(request.headers.get("authorization")).toBe("Bearer test")
                expect(request.headers.get("x-default")).toBe("yes")
                expect(request.headers.get("x-request")).toBe("yes")
                expect(JSON.parse(input.text)).toEqual({
                  model: "glm-image",
                  prompt: "A red circle on a white background",
                  quality: "final",
                  user_id: "final-user",
                  future_option: true,
                  configured: true,
                })
                return input.respond(
                  JSON.stringify({
                    created: 1_760_335_349,
                    id: "generation-1",
                    request_id: "request-1",
                    data: [{ url: "https://cdn.z.ai/generated.png" }],
                    content_filter: [{ role: "future-role", level: 4.5 }],
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

  it.effect("lets raw native options override aliases", () =>
    Image.generate({
      model: ZAI.configure({ apiKey: "test" }).image("model"),
      prompt: "test",
      options: { quality: "future-quality", userID: "x", user_id: "raw-user" },
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(JSON.parse(input.text)).toMatchObject({ quality: "future-quality", user_id: "raw-user" })
              return Effect.succeed(
                input.respond(JSON.stringify({ data: [{ url: "https://example.test/image.jpg" }] }), {
                  headers: { "content-type": "application/json" },
                }),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("rejects invalid response structures", () =>
    Effect.gen(function* () {
      const model = ZAI.configure({ apiKey: "test" }).image("model")
      const payloads = [
        {},
        { data: [] },
        { data: [{ b64_json: "image" }] },
        { data: [{ url: 1 }] },
        { data: [{ url: "https://example.test/image.jpg" }], content_filter: [{ role: 1, level: "high" }] },
      ]

      yield* Effect.forEach(payloads, (payload) =>
        Image.generate({ model, prompt: "test" }).pipe(
          Effect.provide(
            ImageClient.layer.pipe(
              Layer.provide(
                fixedResponse(JSON.stringify(payload), { headers: { "content-type": "application/json" } }),
              ),
            ),
          ),
          Effect.flip,
          Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidProviderOutput"))),
        ),
      )
    }),
  )
})
