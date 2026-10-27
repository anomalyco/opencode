import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { Image, ImageClient, Media } from "../../src/effect.js"
import { CloudflareWorkersAI } from "../../src/providers.js"
import { ProviderConfigurationError } from "../../src/schema/index.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"

const workers = CloudflareWorkersAI.configure({ accountId: "test-account", apiKey: "test" })

describe("Cloudflare Workers AI Images", () => {
  test("derives the Run API base only from an /ai/v1 base", () => {
    expect(CloudflareWorkersAI.runBaseURL({ baseURL: "https://proxy.test/client/v4/accounts/a/ai/v1" })).toBe(
      "https://proxy.test/client/v4/accounts/a/ai/run",
    )
    const gateway = CloudflareWorkersAI.configure({
      baseURL: "https://gateway.ai.cloudflare.com/v1/a/g/workers-ai/v1",
      apiKey: "test",
    })
    expect(() => gateway.image("@cf/black-forest-labs/flux-1-schnell")).toThrow(ProviderConfigurationError)
  })

  it.effect("posts JSON inputs to the Run API and decodes the base64 envelope", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: workers.image("@cf/leonardo/lucid-origin"),
        prompt: "A red apple",
        providerOptions: { width: 512, height: 256, seed: 7, steps: 4, guidance: 3 },
        http: { body: { guidance: 5 } },
      })

      expect(response.image.mediaType).toBe("image/png")
      expect(response.providerMetadata).toEqual({ "cloudflare-workers-ai": { usage: { neurons: 12 } } })
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe(
                  "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/leonardo/lucid-origin",
                )
                expect(request.headers.get("authorization")).toBe("Bearer test")
                expect(JSON.parse(input.text)).toEqual({
                  prompt: "A red apple",
                  width: 512,
                  height: 256,
                  seed: 7,
                  steps: 4,
                  guidance: 5,
                })
                return input.respond(
                  JSON.stringify({
                    result: { image: "iVBORw0KGgo=", usage: { neurons: 12 } },
                    success: true,
                    errors: [],
                    messages: [],
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

  it.effect("rejects an envelope without an image", () =>
    Image.generate({ model: workers.image("@cf/black-forest-labs/flux-1-schnell"), prompt: "test" }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            fixedResponse(JSON.stringify({ result: {}, success: true, errors: [], messages: [] }), {
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ),
      Effect.flip,
      Effect.map((error) => expect(error.reason._tag).toBe("InvalidProviderOutput")),
    ),
  )

  it.effect("sends FLUX.2 input images as numbered multipart files", () =>
    Image.generate({
      model: workers.image("@cf/black-forest-labs/flux-2-klein-4b"),
      prompt: "Put the cat from image 1 in image 0",
      images: [Media.bytes(new Uint8Array([1, 2]), "image/png"), Media.base64("AwQ=", "image/jpeg")],
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                const form = yield* Effect.promise(() => request.formData())
                const bytes = yield* Effect.forEach(["input_image_0", "input_image_1"], (name) =>
                  Effect.promise(async () => [...new Uint8Array(await (form.get(name) as Blob).arrayBuffer())]),
                )
                expect(form.get("prompt")).toBe("Put the cat from image 1 in image 0")
                expect(bytes).toEqual([
                  [1, 2],
                  [3, 4],
                ])
                return input.respond(JSON.stringify({ result: { image: "iVBORw0KGgo=" } }), {
                  headers: { "content-type": "application/json" },
                })
              }),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("sends the first input image of a JSON model as image_b64", () =>
    Image.generate({
      model: workers.image("@cf/lykon/dreamshaper-8-lcm"),
      prompt: "Make it green",
      images: [Media.bytes(new Uint8Array([1, 2, 3]), "image/png")],
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(JSON.parse(input.text)).toEqual({ prompt: "Make it green", image_b64: "AQID" })
              return Effect.succeed(input.respond(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("fails typed for fields the Run API image models cannot take", () =>
    Effect.gen(function* () {
      const image = Media.bytes(new Uint8Array([1]), "image/png")
      const errors = yield* Effect.forEach(
        [
          { model: workers.image("@cf/black-forest-labs/flux-2-dev"), prompt: "test", n: 2 },
          { model: workers.image("@cf/lykon/dreamshaper-8-lcm"), prompt: "test", images: [image, image] },
        ],
        (request) => Image.generate(request).pipe(Effect.flip),
      )
      expect(errors.map((error) => error.reason._tag)).toEqual(["UnsupportedOperation", "UnsupportedOperation"])
    }).pipe(Effect.provide(ImageClient.layer.pipe(Layer.provide(fixedResponse("unused"))))),
  )
})
