import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Image, ImageClient } from "../../src"
import { ZAI } from "../../src/providers"
import { it } from "../lib/effect"
import { dynamicResponse } from "../lib/http"

describe("Z.ai Images", () => {
  it.effect("generates through the Z.ai Images API", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: ZAI.configure({
          apiKey: "test",
          baseURL: "https://api.z.ai.test/api/paas/v4",
          headers: { "x-default": "yes" },
          http: { body: { request_metadata: "value" }, query: { trace: "default" } },
          image: { providerOptions: { quality: "standard", userID: "user-123" } },
        }).image("glm-image"),
        prompt: "A red circle on a white background",
        size: { width: 1280, height: 1280 },
        providerOptions: { zai: { quality: "hd" } },
        http: { headers: { "x-request": "yes" }, query: { trace: "request" } },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/jpeg")
      expect(response.image?.data).toBe("https://cdn.z.ai/generated.png")
      expect(response.providerMetadata).toEqual({
        zai: {
          created: 1_760_335_349,
          id: "generation-1",
          requestID: "request-1",
          contentFilter: [{ role: "assistant", level: 3 }],
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
                  size: "1280x1280",
                  quality: "hd",
                  user_id: "user-123",
                  request_metadata: "value",
                })
                return input.respond(
                  JSON.stringify({
                    created: 1_760_335_349,
                    id: "generation-1",
                    request_id: "request-1",
                    data: [{ url: "https://cdn.z.ai/generated.png" }],
                    content_filter: [{ role: "assistant", level: 3 }],
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
