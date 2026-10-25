import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { Image, ImageClient, Media } from "../../src/effect.js"
import { Alibaba } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"

const json = { headers: { "content-type": "application/json" } }
const result = JSON.stringify({
  output: { choices: [{ message: { content: [{ image: "https://oss.example/generated.png" }] } }] },
})

describe("Alibaba Images", () => {
  it.effect("generates through the Model Studio multimodal generation API", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: Alibaba.configure({
          region: "cn-beijing",
          workspaceID: "llm-fixture",
          apiKey: "test",
          headers: { "x-default": "yes" },
        }).image("wan2.7-image-pro"),
        prompt: "Put the clock from image 1 into image 2",
        images: [Media.url("https://example.test/clock.png"), Media.bytes(new Uint8Array([1, 2, 3]), "image/png")],
        n: 2,
        providerOptions: {
          size: "1024*768",
          seed: 7,
          negativePrompt: "blurry",
          watermark: false,
          thinkingMode: true,
          bbox_list: [[], [[1, 2, 3, 4]]],
        },
        http: { body: { parameters: { watermark: true } } },
      })

      expect(response.images.map((image) => image.source)).toEqual([
        { type: "url", url: "https://oss.example/first.png", expiresAt: 24 * 60 * 60 * 1000 },
        { type: "url", url: "https://oss.example/second.png", expiresAt: 24 * 60 * 60 * 1000 },
      ])
      expect(response.providerMetadata).toEqual({
        alibaba: { requestID: "request-1", usage: { image_count: 2, size: "1024*768" } },
      })
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe(
                  "https://llm-fixture.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
                )
                expect(request.headers.get("authorization")).toBe("Bearer test")
                expect(request.headers.get("x-default")).toBe("yes")
                expect(JSON.parse(input.text)).toEqual({
                  model: "wan2.7-image-pro",
                  input: {
                    messages: [
                      {
                        role: "user",
                        content: [
                          { image: "https://example.test/clock.png" },
                          { image: "data:image/png;base64,AQID" },
                          { text: "Put the clock from image 1 into image 2" },
                        ],
                      },
                    ],
                  },
                  parameters: {
                    size: "1024*768",
                    n: 2,
                    seed: 7,
                    negative_prompt: "blurry",
                    watermark: true,
                    thinking_mode: true,
                    bbox_list: [[], [[1, 2, 3, 4]]],
                  },
                })
                return input.respond(
                  JSON.stringify({
                    output: {
                      choices: [
                        { message: { content: [{ image: "https://oss.example/first.png", type: "image" }] } },
                        { message: { content: [{ image: "https://oss.example/second.png", type: "image" }] } },
                      ],
                      finished: true,
                    },
                    usage: { image_count: 2, size: "1024*768" },
                    request_id: "request-1",
                  }),
                  json,
                )
              }),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("uses the regional shared host and complete base URL overrides", () =>
    Effect.gen(function* () {
      const urls: Array<string> = []
      const layer = ImageClient.layer.pipe(
        Layer.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              urls.push(input.request.url)
              return input.respond(result, json)
            }),
          ),
        ),
      )
      for (const config of [
        { region: "ap-southeast-1" },
        { region: "us-east-1" },
        { baseURL: "https://token-plan.example/api/v1" },
      ])
        yield* Image.generate({
          model: Alibaba.configure({ ...config, apiKey: "test" }).image("qwen-image-2.0"),
          prompt: "test",
        }).pipe(Effect.provide(layer))

      expect(urls).toEqual([
        "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        "https://dashscope-us.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        "https://token-plan.example/api/v1/services/aigc/multimodal-generation/generation",
      ])
    }),
  )

  it.effect("rejects provider refs and unsupported common fields before sending", () =>
    Effect.gen(function* () {
      const model = Alibaba.configure({ region: "ap-southeast-1", apiKey: "test" }).image("qwen-image-2.0")
      const layer = ImageClient.layer.pipe(Layer.provide(fixedResponse(result, json)))
      const ref = yield* Image.generate({ model, prompt: "test", images: [Media.ref("alibaba", "file-1")] }).pipe(
        Effect.provide(layer),
        Effect.flip,
      )
      const tooLarge = yield* Image.generate({ model, prompt: "test", aspect: "1:1", resolution: "4K" }).pipe(
        Effect.provide(layer),
        Effect.flip,
      )

      expect(ref.reason._tag).toBe("InvalidRequest")
      expect(tooLarge.reason).toMatchObject({
        _tag: "UnsupportedOperation",
        operation: "media.resolution",
        message:
          "Alibaba Images can't render 1:1 at 4K; the closest size it takes is 2048x2048 (1:1). Change aspect or resolution, or set the size in providerOptions",
      })
    }),
  )

  it.effect("rejects invalid response structures", () =>
    Effect.gen(function* () {
      const model = Alibaba.configure({ region: "ap-southeast-1", apiKey: "test" }).image("qwen-image-2.0")
      const payloads = [
        {},
        { output: { choices: [] } },
        { output: { choices: [{ message: { content: [{ text: "no image" }] } }] } },
        { output: { choices: [{ message: { content: [{ image: 1 }] } }] } },
      ]

      yield* Effect.forEach(payloads, (payload) =>
        Image.generate({ model, prompt: "test" }).pipe(
          Effect.provide(ImageClient.layer.pipe(Layer.provide(fixedResponse(JSON.stringify(payload), json)))),
          Effect.flip,
          Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidProviderOutput"))),
        ),
      )
    }),
  )

  it.effect("surfaces Model Studio error messages", () =>
    Effect.gen(function* () {
      const error = yield* Image.generate({
        model: Alibaba.configure({ region: "ap-southeast-1", apiKey: "test" }).image("qwen-image-2.0"),
        prompt: "test",
      }).pipe(
        Effect.provide(
          ImageClient.layer.pipe(
            Layer.provide(
              fixedResponse(JSON.stringify({ code: "InvalidParameter", message: "Model not exist.", request_id: "r" }), {
                status: 400,
                ...json,
              }),
            ),
          ),
        ),
        Effect.flip,
      )

      expect([error.reason._tag, error.reason.message]).toEqual(["InvalidRequest", "Model not exist."])
    }),
  )
})
