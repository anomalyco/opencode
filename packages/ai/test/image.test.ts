import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Image, ImageClient, ImageInput } from "../src"
import { Google, OpenAI, XAI, ZAI } from "../src/providers"
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
          http: { body: { deployment: "test" }, headers: { "x-default": "yes" } },
        }).image("gpt-image-2"),
        prompt: "A robot tending a rooftop garden",
        options: {
          n: 2,
          size: "2048x2048",
          quality: "future-quality",
          outputFormat: "jpeg",
          output_format: "avif",
          outputCompression: 30,
          output_compression: 40,
          background: "opaque",
          native_default: true,
          future_option: true,
        },
        http: {
          body: { output_format: "webp", output_compression: 50, future_option: "http", request_metadata: "value" },
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
                  size: "2048x2048",
                  quality: "future-quality",
                  background: "opaque",
                  output_format: "webp",
                  output_compression: 50,
                  native_default: true,
                  future_option: "http",
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

  it.effect("preserves native snake_case and unknown request options", () =>
    Image.generate({
      model: OpenAI.configure({
        apiKey: "test",
        baseURL: "https://api.openai.test/v1",
      }).image("future-image-model"),
      prompt: "A lighthouse in fog",
      options: {
        outputFormat: "jpeg",
        output_format: "avif",
        outputCompression: 30,
        output_compression: 40,
        provider_future_option: { enabled: true },
      },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.image?.mediaType).toBe("image/avif")
        }),
      ),
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(JSON.parse(input.text)).toEqual({
                model: "future-image-model",
                prompt: "A lighthouse in fog",
                output_format: "avif",
                output_compression: 40,
                provider_future_option: { enabled: true },
              })
              return Effect.succeed(
                input.respond(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
                  headers: { "content-type": "application/json" },
                }),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("routes OpenAI byte inputs and masks through multipart edits", () =>
    Image.generate({
      model: OpenAI.configure({ apiKey: "test", baseURL: "https://api.openai.test/v1" }).image("future-model"),
      prompt: "Combine these images",
      images: [
        ImageInput.bytes(Uint8Array.from([1, 2, 3]), "image/png"),
        ImageInput.url("data:image/jpeg;base64,BAUG"),
      ],
      options: {
        mask: ImageInput.bytes(Uint8Array.from([7, 8, 9]), "image/png"),
        quality: "high",
        future_option: true,
      },
      http: {
        body: { quality: "low", model: "corrupt", prompt: "corrupt", image: "corrupt", "image[]": "corrupt" },
        headers: { "content-type": "application/json" },
      },
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe("https://api.openai.test/v1/images/edits")
                expect(request.headers.get("content-type")).toStartWith("multipart/form-data; boundary=")
                expect(input.text).toContain('name="model"\r\n\r\nfuture-model')
                expect(input.text).toContain('name="prompt"\r\n\r\nCombine these images')
                expect(input.text.match(/name="image\[\]"/g)).toHaveLength(2)
                expect(input.text).toContain('name="mask"')
                expect(input.text).toContain('name="quality"\r\n\r\nlow')
                expect(input.text).not.toContain("corrupt")
                return input.respond(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
                  headers: { "content-type": "application/json" },
                })
              }),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("routes OpenAI URL and file inputs through JSON edits", () =>
    Image.generate({
      model: OpenAI.configure({ apiKey: "test", baseURL: "https://api.openai.test/v1" }).image("future-model"),
      prompt: "Combine these images",
      images: [ImageInput.url("https://example.test/source.png"), ImageInput.file("file_123")],
      options: { mask: ImageInput.file("file_mask") },
      http: { body: { future_option: true } },
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(JSON.parse(input.text)).toEqual({
                model: "future-model",
                prompt: "Combine these images",
                images: [{ image_url: "https://example.test/source.png" }, { file_id: "file_123" }],
                mask: { file_id: "file_mask" },
                future_option: true,
              })
              return Effect.succeed(
                input.respond(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
                  headers: { "content-type": "application/json" },
                }),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("routes ordered xAI image inputs through JSON edits", () =>
    Image.generate({
      model: XAI.configure({ apiKey: "test", baseURL: "https://api.xai.test/v1" }).image("future-model"),
      prompt: "Combine these images",
      images: [
        ImageInput.bytes(Uint8Array.from([1, 2, 3]), "image/png"),
        ImageInput.url("https://example.test/source.jpg"),
        ImageInput.file("file_123"),
      ],
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(JSON.parse(input.text)).toEqual({
                model: "future-model",
                prompt: "Combine these images",
                images: [
                  { url: "data:image/png;base64,AQID", type: "image_url" },
                  { url: "https://example.test/source.jpg", type: "image_url" },
                  { file_id: "file_123" },
                ],
              })
              return Effect.succeed(
                input.respond(JSON.stringify({ data: [{ b64_json: "AQID", mime_type: "image/png" }] }), {
                  headers: { "content-type": "application/json" },
                }),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("uses xAI's singular image field for one input", () =>
    Image.generate({
      model: XAI.configure({ apiKey: "test", baseURL: "https://api.xai.test/v1" }).image("future-model"),
      prompt: "Edit this image",
      images: [ImageInput.file("file_123")],
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(JSON.parse(input.text)).toEqual({
                model: "future-model",
                prompt: "Edit this image",
                image: { file_id: "file_123" },
              })
              return Effect.succeed(
                input.respond(JSON.stringify({ data: [{ b64_json: "AQID", mime_type: "image/png" }] }), {
                  headers: { "content-type": "application/json" },
                }),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("lowers ordered Google image inputs into generateContent parts", () =>
    Image.generate({
      model: Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).image("future-model"),
      prompt: "Combine these images",
      images: [
        ImageInput.bytes(Uint8Array.from([1, 2, 3]), "image/png"),
        ImageInput.url("data:image/jpeg;base64,BAUG"),
        ImageInput.fileUri("https://generativelanguage.googleapis.com/v1beta/files/123", "image/webp"),
      ],
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(JSON.parse(input.text).contents[0].parts).toEqual([
                { text: "Combine these images" },
                { inlineData: { mimeType: "image/png", data: "AQID" } },
                { inlineData: { mimeType: "image/jpeg", data: "BAUG" } },
                {
                  fileData: {
                    mimeType: "image/webp",
                    fileUri: "https://generativelanguage.googleapis.com/v1beta/files/123",
                  },
                },
              ])
              return Effect.succeed(
                input.respond(
                  JSON.stringify({
                    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AQID" } }] } }],
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("rejects unsupported provider inputs before sending", () =>
    Effect.gen(function* () {
      const cases = [
        Image.generate({
          model: Google.configure({ apiKey: "test" }).image("model"),
          prompt: "edit",
          images: [ImageInput.url("https://example.test/image.png")],
        }),
        Image.generate({
          model: ZAI.configure({ apiKey: "test" }).image("model"),
          prompt: "edit",
          images: [ImageInput.bytes(Uint8Array.from([1]), "image/png")],
        }),
      ]
      yield* Effect.forEach(cases, (program) =>
        program.pipe(
          Effect.flip,
          Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidRequest"))),
        ),
      )
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(dynamicResponse(() => Effect.die("unsupported input reached the network"))),
        ),
      ),
    ),
  )

  it.effect("generates images through the Google generateContent API", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: Google.configure({
          apiKey: "test",
          baseURL: "https://generativelanguage.test/v1beta/",
          headers: { "x-default": "yes" },
          http: { body: { labels: { deployment: "test" } }, query: { api: "v1" } },
        }).image("any-model-id"),
        prompt: "A robot tending a rooftop garden",
        options: {
          aspectRatio: "16:9",
          imageSize: "2K",
          seed: 42,
          thinkingLevel: "HIGH",
          includeThoughts: true,
          futureOption: true,
          imageConfig: { aspectRatio: "4:3", nativeImageOption: true },
          thinkingConfig: { thinkingLevel: "LOW", nativeThinkingOption: true },
        },
        http: {
          body: {
            safetySettings: [],
            generationConfig: {
              imageConfig: { aspectRatio: "3:2", httpImageOption: true },
              thinkingConfig: { includeThoughts: false, httpThinkingOption: true },
              futureOption: "http",
              httpOption: true,
            },
          },
          headers: { "x-request": "yes" },
          query: { trace: "1" },
        },
      })

      expect(response.images).toHaveLength(3)
      expect(response.images.map((image) => image.data)).toEqual([
        Uint8Array.from([1, 2, 3]),
        Uint8Array.from([4, 5, 6]),
        Uint8Array.from([7, 8, 9]),
      ])
      expect(response.images.map((image) => image.mediaType)).toEqual(["image/png", "image/jpeg", "image/webp"])
      expect(response.images[0].providerMetadata).toMatchObject({ google: { thoughtSignature: "signature-1" } })
      expect(response.images[1].providerMetadata).toMatchObject({
        google: { candidateIndex: 0, partIndex: 3, finishReason: "STOP" },
      })
      expect(response.images[2].providerMetadata).toMatchObject({ google: { candidateIndex: 7, partIndex: 0 } })
      expect(response.usage?.inputTokens).toBe(5)
      expect(response.usage?.outputTokens).toBe(10)
      expect(response.usage?.reasoningTokens).toBe(3)
      expect(response.usage?.providerMetadata).toMatchObject({ google: { serviceTier: "STANDARD" } })
      expect(response.providerMetadata).toEqual({
        google: {
          modelVersion: "gemini-3.1-flash-image",
          responseId: "response-1",
          promptFeedback: undefined,
          candidates: [
            {
              index: 0,
              finishReason: "STOP",
              finishMessage: undefined,
              safetyRatings: [{ category: "safe" }],
              citationMetadata: undefined,
              groundingMetadata: undefined,
              parts: [
                {
                  type: "inlineData",
                  mediaType: "image/png",
                  thought: undefined,
                  thoughtSignature: "signature-1",
                },
                { type: "text", text: "planning", thought: true, thoughtSignature: "text-signature" },
                {
                  type: "inlineData",
                  mediaType: "image/png",
                  thought: true,
                  thoughtSignature: "draft-signature",
                },
                {
                  type: "inlineData",
                  mediaType: "image/jpeg",
                  thought: undefined,
                  thoughtSignature: undefined,
                },
              ],
            },
            {
              index: 7,
              finishReason: undefined,
              finishMessage: undefined,
              safetyRatings: undefined,
              citationMetadata: undefined,
              groundingMetadata: undefined,
              parts: [
                {
                  type: "inlineData",
                  mediaType: "image/webp",
                  thought: undefined,
                  thoughtSignature: undefined,
                },
              ],
            },
          ],
        },
      })
    }).pipe(
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe(
                  "https://generativelanguage.test/v1beta/models/any-model-id:generateContent?api=v1&trace=1",
                )
                expect(request.headers.get("x-goog-api-key")).toBe("test")
                expect(request.headers.get("x-default")).toBe("yes")
                expect(request.headers.get("x-request")).toBe("yes")
                expect(JSON.parse(input.text)).toEqual({
                  contents: [{ role: "user", parts: [{ text: "A robot tending a rooftop garden" }] }],
                  generationConfig: {
                    responseModalities: ["IMAGE"],
                    imageConfig: {
                      aspectRatio: "3:2",
                      imageSize: "2K",
                      nativeImageOption: true,
                      httpImageOption: true,
                    },
                    seed: 42,
                    thinkingConfig: {
                      thinkingLevel: "LOW",
                      includeThoughts: false,
                      nativeThinkingOption: true,
                      httpThinkingOption: true,
                    },
                    futureOption: "http",
                    httpOption: true,
                  },
                  labels: { deployment: "test" },
                  safetySettings: [],
                })
                return input.respond(
                  JSON.stringify({
                    candidates: [
                      {
                        content: {
                          parts: [
                            {
                              inlineData: { mimeType: "image/png", data: "AQID" },
                              thoughtSignature: "signature-1",
                            },
                            { text: "planning", thought: true, thoughtSignature: "text-signature" },
                            {
                              inlineData: { mimeType: "image/png", data: "CgsM" },
                              thought: true,
                              thoughtSignature: "draft-signature",
                            },
                            { inlineData: { mimeType: "image/jpeg", data: "BAUG" } },
                          ],
                        },
                        finishReason: "STOP",
                        safetyRatings: [{ category: "safe" }],
                      },
                      {
                        index: 7,
                        content: { parts: [{ inlineData: { mimeType: "image/webp", data: "BwgJ" } }] },
                      },
                    ],
                    usageMetadata: {
                      promptTokenCount: 5,
                      candidatesTokenCount: 7,
                      thoughtsTokenCount: 3,
                      totalTokenCount: 15,
                      serviceTier: "STANDARD",
                    },
                    modelVersion: "gemini-3.1-flash-image",
                    responseId: "response-1",
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

  it.effect("includes Google diagnostics when no final image is returned", () =>
    Image.generate({
      model: Google.configure({ apiKey: "test", baseURL: "https://generativelanguage.test/v1beta" }).image(
        "gemini-3.1-flash-image",
      ),
      prompt: "A robot tending a rooftop garden",
    }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error.reason._tag).toBe("InvalidProviderOutput")
          if (error.reason._tag !== "InvalidProviderOutput") return
          expect(error.reason.message).toContain("finish reasons: IMAGE_SAFETY")
          expect(error.reason.providerMetadata).toEqual({
            google: {
              promptFeedback: { blockReason: "SAFETY" },
              candidates: [
                {
                  index: 0,
                  finishReason: "IMAGE_SAFETY",
                  finishMessage: "The generated image was blocked by safety filters.",
                  safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", blocked: true }],
                  citationMetadata: undefined,
                  groundingMetadata: undefined,
                  parts: [{ type: "text", text: "blocked", thought: false, thoughtSignature: undefined }],
                },
              ],
            },
          })
        }),
      ),
      Effect.provide(
        ImageClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.succeed(
                input.respond(
                  JSON.stringify({
                    candidates: [
                      {
                        content: { parts: [{ text: "blocked", thought: false }] },
                        finishReason: "IMAGE_SAFETY",
                        finishMessage: "The generated image was blocked by safety filters.",
                        safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", blocked: true }],
                      },
                    ],
                    promptFeedback: { blockReason: "SAFETY" },
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
})
