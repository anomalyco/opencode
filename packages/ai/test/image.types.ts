import { Effect } from "effect"
import {
  ai,
  ImageClient,
  ImageModel,
  type ImageModelOptions,
  type ImageOptions,
  type ImageRequest,
  Media,
} from "../src/effect.js"
import type { Service } from "../src/image-client.js"
import { anthropic, google, openai, xai, zai } from "../src/providers.js"

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

type GoogleLikeOptions = {
  readonly imageSize?: "1K" | "2K"
  readonly thinkingLevel?: "LOW" | "HIGH"
} & Record<string, unknown>

declare const googleModel: ImageModel<GoogleLikeOptions>
// @ts-expect-error Extracted model options retain known provider fields.
const invalidGoogleOptions: ImageModelOptions<typeof googleModel> = { imageSize: "8K" }
void invalidGoogleOptions

ai.image.generate({
  model: googleModel,
  prompt: "A lighthouse",
  images: [
    Media.bytes(Uint8Array.from([1, 2, 3]), "image/png"),
    Media.fromDataUrl("data:image/jpeg;base64,AQID"),
    Media.ref("google", "https://generativelanguage.googleapis.com/v1beta/files/example", "image/webp"),
  ],
  aspect: "16:9",
  resolution: "2K",
  providerOptions: { imageSize: "2K", thinkingLevel: "HIGH", futureOption: true },
})

const googleProvider = google.configure({ apiKey: "test" }).image("any-model-id")
ai.image.generate({
  model: googleProvider,
  prompt: "A lighthouse",
  aspect: "16:9",
  resolution: "2K",
  providerOptions: {
    seed: 7,
    thinkingLevel: "HIGH",
    includeThoughts: true,
    futureOption: true,
  },
})
ai.image.generate({
  model: googleProvider,
  prompt: "A lighthouse",
  resolution: "8K",
  providerOptions: { thinkingLevel: "FUTURE" },
})
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
google.configure({ image: { providerOptions: { thinkingLevel: "HIGH" } } })
// @ts-expect-error Known Google string options retain their value kind.
ai.image.generate({ model: googleProvider, prompt: "A lighthouse", providerOptions: { thinkingLevel: 2 } })
// @ts-expect-error Known Google numeric options retain their value kind.
ai.image.generate({ model: googleProvider, prompt: "A lighthouse", providerOptions: { seed: "7" } })
// @ts-expect-error Resolution tiers are strings.
ai.image.generate({ model: googleProvider, prompt: "A lighthouse", resolution: 2 })
// @ts-expect-error Known Google boolean options retain their value kind.
ai.image.generate({ model: googleProvider, prompt: "A lighthouse", providerOptions: { includeThoughts: "yes" } })

const openaiModel = openai.image("gpt-image-2")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
openai.configure({ image: { providerOptions: { quality: "medium" } } })
const futureOpenAIOptions: ImageModelOptions<typeof openaiModel> = { quality: "future-quality" }
void futureOpenAIOptions
ai.image.generate({
  model: openaiModel,
  prompt: "A lighthouse",
  images: [Media.url("https://example.com/source.png"), Media.ref("openai", "file_123")],
  n: 2,
  providerOptions: {
    mask: Media.bytes(Uint8Array.from([1]), "image/png"),
    size: "2048x2048",
    outputFormat: "webp",
    quality: "hd",
    background: "transparent",
    future_option: true,
  },
})
ai.image.generate({
  model: openaiModel,
  prompt: "A lighthouse",
  aspect: "16:9",
  resolution: "4K",
  providerOptions: { quality: "future-quality" },
})
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", providerOptions: { outputFormat: "future-format" } })
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", providerOptions: { native_future_option: true } })
// @ts-expect-error Known OpenAI string options retain their value kind.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", providerOptions: { quality: 1 } })
// @ts-expect-error Known OpenAI numeric options retain their value kind.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", providerOptions: { outputCompression: "80" } })
// @ts-expect-error Partial image counts are numeric.
ai.image.stream({ model: openaiModel, prompt: "A lighthouse", providerOptions: { partialImages: "1" } })
openai.imageGeneration({ action: "future-action", quality: "future-quality", size: "2048x2048" })
// @ts-expect-error Hosted image generation numeric options retain their value kind.
openai.imageGeneration({ partialImages: "2" })
// @ts-expect-error Known Google-like options are inferred from the selected model.
ai.image.generate({ model: googleModel, prompt: "A lighthouse", providerOptions: { imageSize: "8K" } })

// @ts-expect-error Language models cannot be used for image requests.
ai.image.generate({ model: anthropic.configure({ apiKey: "test" })("claude-sonnet-4-5"), prompt: "A lighthouse" })

const xaiModel = xai.configure({ apiKey: "test" }).image("any-model-id")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
xai.configure({ image: { providerOptions: { responseFormat: "b64_json" } } })
ai.image.generate({
  model: xaiModel,
  prompt: "A lighthouse",
  images: [Media.fromDataUrl("data:image/png;base64,AQID"), Media.ref("xai", "file_123")],
  n: 2,
  aspect: "16:9",
  resolution: "future-resolution",
  providerOptions: {
    responseFormat: "future-format",
    future_option: true,
  },
})
ai.image.generate({
  model: xaiModel,
  prompt: "A lighthouse",
  providerOptions: { response_format: "b64_json", native_future_option: true },
})
// @ts-expect-error Common count is numeric.
ai.image.generate({ model: xaiModel, prompt: "A lighthouse", n: "2" })
// @ts-expect-error Known xAI string options retain their value kind.
ai.image.generate({ model: xaiModel, prompt: "A lighthouse", providerOptions: { responseFormat: 2 } })

const zaiModel = zai.configure({ apiKey: "test" }).image("any-model-id")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
zai.configure({ image: { providerOptions: { quality: "hd" } } })
ai.image.generate({
  model: zaiModel,
  prompt: "A lighthouse",
  providerOptions: { quality: "future-quality", userID: "user-123", future_option: true },
})
ai.image.generate({ model: zaiModel, prompt: "A lighthouse", providerOptions: { user_id: "raw-user" } })
// @ts-expect-error Known Z.ai string options retain their value kind.
ai.image.generate({ model: zaiModel, prompt: "A lighthouse", providerOptions: { quality: 1 } })
// @ts-expect-error Known Z.ai user IDs retain their value kind.
ai.image.generate({ model: zaiModel, prompt: "A lighthouse", providerOptions: { userID: 1 } })

declare const generic: ImageModel<ImageOptions>
const widenImage = <Options extends ImageOptions>(model: ImageModel<Options>): ImageModel => model
void widenImage
ai.image.generate({ model: generic, prompt: "A lighthouse", providerOptions: { arbitrary: true } })
const explicitAsset: Media.Asset = Media.url("https://example.com/image.png")
void explicitAsset

// @ts-expect-error Raw strings are ambiguous and are not media assets.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", images: ["AQID"] })
// @ts-expect-error Plain source objects must be lifted into `Media.Asset` first.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", images: [{ type: "bytes", data: new Uint8Array() }] })
ai.image.generate({
  model: openaiModel,
  prompt: "A lighthouse",
  // @ts-expect-error Masks are media assets, not strings.
  providerOptions: { mask: "https://example.com/mask.png" },
})

const request = ai.image.request({
  model: googleModel,
  prompt: "A lighthouse",
  providerOptions: { imageSize: "1K", futureOption: true },
})
const typedRequest: ImageRequest<ImageModel<GoogleLikeOptions>> = request
void typedRequest
const generated = ImageClient.generate(request)
type GenerateRequirements = Assert<Equal<Requirements<typeof generated>, Service>>
void (true satisfies GenerateRequirements)

// @ts-expect-error Image requests use `n`, not `count`.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", count: 2 })
// @ts-expect-error Exact sizes are provider options, not common fields.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", size: "1024x1024" })
// @ts-expect-error Aspect ratios are `${w}:${h}` strings.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", aspect: "wide" })
// @ts-expect-error Image requests do not expose metadata.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", metadata: { trace: true } })
// @ts-expect-error `options` was renamed to `providerOptions`.
ai.image.generate({ model: openaiModel, prompt: "A lighthouse", options: { quality: "hd" } })
