import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Image, ImageClient, ImageInput } from "../../src"
import { Alibaba } from "../../src/providers"
import { it } from "../lib/effect"
import { dynamicResponse } from "../lib/http"

const payload = (url = "https://example.com/result.png?Expires=1893456000") => ({
  output: { choices: [{ message: { content: [{ image: url }] } }] },
  usage: { total_tokens: 12 },
  request_id: "request-alibaba",
})

const layer = (inspect: (body: Record<string, unknown>) => void, url?: string) =>
  ImageClient.layer.pipe(
    Layer.provide(
      dynamicResponse((input) => {
        inspect(JSON.parse(input.text))
        return Effect.succeed(
          input.respond(JSON.stringify(payload(url)), { headers: { "content-type": "application/json" } }),
        )
      }),
    ),
  )

describe("Alibaba Images", () => {
  it.effect("supports open options and arbitrary models", () =>
    Effect.gen(function* () {
      const result = yield* Image.generate({
        model: Alibaba.configure({ apiKey: "test" }).image("future-model-id"),
        prompt: "A robot",
        options: {
          resolution: "2K",
          negativePrompt: "blurry",
          negative_prompt: "native wins",
          future_parameter: true,
        },
        http: {
          body: {
            model: "ignored-model",
            input: { messages: [] },
            parameters: { seed: 7 },
          },
        },
      })
      expect(result.image?.expiresAt).toBe("2030-01-01T00:00:00.000Z")
    }).pipe(
      Effect.provide(
        layer((body) => {
          expect(body.model).toBe("future-model-id")
          expect(body.input).toEqual({ messages: [{ role: "user", content: [{ text: "A robot" }] }] })
          expect(body.parameters).toEqual({
            size: "2K",
            negative_prompt: "native wins",
            future_parameter: true,
            seed: 7,
          })
        }),
      ),
    ),
  )

  it.effect("lowers ordered image inputs before text", () =>
    Image.generate({
      model: Alibaba.configure({ apiKey: "test" }).image("qwen-image-2.0"),
      prompt: "Combine these",
      images: [
        ImageInput.url("https://example.com/first.png"),
        ImageInput.bytes(Uint8Array.from([1, 2, 3]), "image/png"),
      ],
    }).pipe(
      Effect.provide(
        layer((body) => {
          const input = body.input as { messages: Array<{ content: unknown }> }
          expect(input.messages[0].content).toEqual([
            { image: "https://example.com/first.png" },
            { image: "data:image/png;base64,AQID" },
            { text: "Combine these" },
          ])
        }),
      ),
    ),
  )

  it.effect("rejects provider file inputs", () =>
    Image.generate({
      model: Alibaba.configure({ apiKey: "test" }).image("any-model"),
      prompt: "A robot",
      images: [ImageInput.file("file_123")],
    }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidRequest"))),
      Effect.provide(
        ImageClient.layer.pipe(Layer.provide(dynamicResponse(() => Effect.die("must fail before network I/O")))),
      ),
    ),
  )

  it.effect("ignores expiration values outside the Date range", () =>
    Effect.gen(function* () {
      const result = yield* Image.generate({
        model: Alibaba.configure({ apiKey: "test" }).image("any-model"),
        prompt: "A robot",
      })
      expect(result.image?.expiresAt).toBeUndefined()
      expect(result.usage?.totalTokens).toBe(12)
    }).pipe(Effect.provide(layer(() => {}, "https://example.com/result.png?Expires=9007199254740991"))),
  )
})
