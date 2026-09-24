import { Effect } from "effect"
import {
  Image,
  ImageClient,
  ImageModel,
  Media,
  type ImageModelOptions,
  type ImageOptions,
  type ImageRequestFor,
} from "../src/index.js"
import type { Service } from "../src/image-client.js"
import { Anthropic, BlackForestLabs, Google, OpenAI, Stability, XAI, ZAI } from "../src/providers.js"

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

type GoogleLikeOptions = {
  readonly imageSize?: "1K" | "2K"
  readonly thinkingLevel?: "LOW" | "HIGH"
} & Record<string, unknown>

declare const google: ImageModel<GoogleLikeOptions>
// @ts-expect-error Extracted model options retain known provider fields.
const invalidGoogleOptions: ImageModelOptions<typeof google> = { imageSize: "8K" }
void invalidGoogleOptions

Image.generate({
  model: google,
  prompt: "A lighthouse",
  images: [
    Media.bytes(Uint8Array.from([1, 2, 3]), "image/png"),
    Media.fromDataUrl("data:image/jpeg;base64,AQID"),
    Media.ref("google", "https://generativelanguage.googleapis.com/v1beta/files/example", "image/webp"),
  ],
  aspectRatio: "16:9",
  seed: 7,
  providerOptions: { imageSize: "2K", thinkingLevel: "HIGH", futureOption: true },
})

const googleProvider = Google.configure({ apiKey: "test" }).image("any-model-id")
Image.generate({
  model: googleProvider,
  prompt: "A lighthouse",
  aspectRatio: "16:9",
  providerOptions: {
    imageSize: "2K",
    thinkingLevel: "HIGH",
    includeThoughts: true,
    futureOption: true,
  },
})
Image.generate({
  model: googleProvider,
  prompt: "A lighthouse",
  providerOptions: { imageSize: "8K", thinkingLevel: "FUTURE" },
})
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
Google.configure({ image: { providerOptions: { imageSize: "2K" } } })
// @ts-expect-error Known Google string options retain their value kind.
Image.generate({ model: googleProvider, prompt: "A lighthouse", providerOptions: { imageSize: 2 } })
// @ts-expect-error Known Google boolean options retain their value kind.
Image.generate({ model: googleProvider, prompt: "A lighthouse", providerOptions: { includeThoughts: "yes" } })

const openai = OpenAI.image("gpt-image-2")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
OpenAI.configure({ image: { providerOptions: { quality: "medium" } } })
const futureOpenAIOptions: ImageModelOptions<typeof openai> = { quality: "future-quality" }
void futureOpenAIOptions
Image.generate({
  model: openai,
  prompt: "A lighthouse",
  images: [Media.url("https://example.com/source.png"), Media.ref("openai", "file_123")],
  mask: Media.bytes(Uint8Array.from([1]), "image/png"),
  n: 2,
  size: "2048x2048",
  format: "webp",
  providerOptions: {
    quality: "hd",
    background: "transparent",
    future_option: true,
  },
})
Image.generate({
  model: openai,
  prompt: "A lighthouse",
  size: "256x256",
  providerOptions: { quality: "future-quality" },
})
Image.generate({ model: openai, prompt: "A lighthouse", format: "future-format" })
Image.generate({ model: openai, prompt: "A lighthouse", providerOptions: { native_future_option: true } })
// @ts-expect-error Known OpenAI string options retain their value kind.
Image.generate({ model: openai, prompt: "A lighthouse", providerOptions: { quality: 1 } })
// @ts-expect-error Known OpenAI numeric options retain their value kind.
Image.generate({ model: openai, prompt: "A lighthouse", providerOptions: { outputCompression: "80" } })
// @ts-expect-error Partial image counts are numeric.
Image.stream({ model: openai, prompt: "A lighthouse", providerOptions: { partialImages: "1" } })
const bfl = BlackForestLabs.configure({ apiKey: "test" }).image("flux-2-pro")
// @ts-expect-error Known BFL numeric options retain their value kind.
Image.start({ model: bfl, prompt: "A lighthouse", providerOptions: { safety_tolerance: "2" } })
const stability = Stability.configure({ apiKey: "test" })
// @ts-expect-error Only the creative upscaler is queued, so the selector takes no model id.
stability.upscale("fast")
OpenAI.imageGeneration({ action: "future-action", quality: "future-quality", size: "2048x2048" })
// @ts-expect-error Hosted image generation numeric options retain their value kind.
OpenAI.imageGeneration({ partialImages: "2" })
// @ts-expect-error Known Google-like options are inferred from the selected model.
Image.generate({ model: google, prompt: "A lighthouse", providerOptions: { imageSize: "8K" } })

// @ts-expect-error Language models cannot be used for image requests.
Image.generate({ model: Anthropic.configure({ apiKey: "test" }).model("claude-sonnet-4-5"), prompt: "A lighthouse" })

const xai = XAI.configure({ apiKey: "test" }).image("any-model-id")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
XAI.configure({ image: { providerOptions: { resolution: "1k" } } })
Image.generate({
  model: xai,
  prompt: "A lighthouse",
  images: [Media.fromDataUrl("data:image/png;base64,AQID"), Media.ref("xai", "file_123")],
  n: 2,
  aspectRatio: "16:9",
  providerOptions: {
    resolution: "future-resolution",
    responseFormat: "future-format",
    future_option: true,
  },
})
Image.generate({
  model: xai,
  prompt: "A lighthouse",
  providerOptions: { response_format: "b64_json", native_future_option: true },
})
// @ts-expect-error Common count is numeric.
Image.generate({ model: xai, prompt: "A lighthouse", n: "2" })
// @ts-expect-error Known xAI string options retain their value kind.
Image.generate({ model: xai, prompt: "A lighthouse", providerOptions: { resolution: 2 } })

const zai = ZAI.configure({ apiKey: "test" }).image("any-model-id")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
ZAI.configure({ image: { providerOptions: { quality: "hd" } } })
Image.generate({
  model: zai,
  prompt: "A lighthouse",
  providerOptions: { quality: "future-quality", userID: "user-123", future_option: true },
})
Image.generate({ model: zai, prompt: "A lighthouse", providerOptions: { user_id: "raw-user" } })
// @ts-expect-error Known Z.ai string options retain their value kind.
Image.generate({ model: zai, prompt: "A lighthouse", providerOptions: { quality: 1 } })
// @ts-expect-error Known Z.ai user IDs retain their value kind.
Image.generate({ model: zai, prompt: "A lighthouse", providerOptions: { userID: 1 } })

declare const generic: ImageModel<ImageOptions>
const widenImage = <Options extends ImageOptions>(model: ImageModel<Options>): ImageModel => model
void widenImage
Image.generate({ model: generic, prompt: "A lighthouse", providerOptions: { arbitrary: true } })
const explicitAsset: Media.Asset = Media.url("https://example.com/image.png")
void explicitAsset

// @ts-expect-error Raw strings are ambiguous and are not media assets.
Image.generate({ model: openai, prompt: "A lighthouse", images: ["AQID"] })
// @ts-expect-error Plain source objects must be lifted into `Media.Asset` first.
Image.generate({ model: openai, prompt: "A lighthouse", images: [{ type: "bytes", data: new Uint8Array() }] })
// @ts-expect-error Masks are media assets, not strings.
Image.generate({ model: openai, prompt: "A lighthouse", mask: "https://example.com/mask.png" })

const request = Image.request({
  model: google,
  prompt: "A lighthouse",
  providerOptions: { imageSize: "1K", futureOption: true },
})
const typedRequest: ImageRequestFor<GoogleLikeOptions> = request
void typedRequest
const generated = ImageClient.generate(request)
type GenerateRequirements = Assert<Equal<Requirements<typeof generated>, Service>>
void (true satisfies GenerateRequirements)

// @ts-expect-error Image requests use `n`, not `count`.
Image.generate({ model: openai, prompt: "A lighthouse", count: 2 })
// @ts-expect-error Image sizes are `${width}x${height}` strings.
Image.generate({ model: openai, prompt: "A lighthouse", size: { width: 1024, height: 1024 } })
// @ts-expect-error Aspect ratios are `${w}:${h}` strings.
Image.generate({ model: openai, prompt: "A lighthouse", aspectRatio: "wide" })
// @ts-expect-error Image requests do not expose metadata.
Image.generate({ model: openai, prompt: "A lighthouse", metadata: { trace: true } })
// @ts-expect-error `options` was renamed to `providerOptions`.
Image.generate({ model: openai, prompt: "A lighthouse", options: { quality: "hd" } })
