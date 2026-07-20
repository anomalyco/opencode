import {
  Image,
  ImageModel,
  type ImageModelOptions,
  type ImageOptions,
  type ImageRequestFor,
  type ImageRoute,
} from "../src"
import { Google, OpenAI, XAI, ZAI } from "../src/providers"

type GoogleLikeOptions = {
  readonly aspectRatio?: "1:1" | "16:9"
  readonly imageSize?: "1K" | "2K"
} & Record<string, unknown>

declare const route: ImageRoute<GoogleLikeOptions>
const google = ImageModel.make<GoogleLikeOptions>({ id: "gemini-image", provider: "google", route })
// @ts-expect-error Extracted model options retain known provider fields.
const invalidGoogleOptions: ImageModelOptions<typeof google> = { aspectRatio: "wide" }
void invalidGoogleOptions

Image.generate({
  model: google,
  prompt: "A lighthouse",
  options: { aspectRatio: "16:9", imageSize: "2K", futureOption: true },
})

const googleProvider = Google.configure({ apiKey: "test" }).image("any-model-id")
Image.generate({
  model: googleProvider,
  prompt: "A lighthouse",
  options: {
    aspectRatio: "16:9",
    imageSize: "2K",
    seed: 42,
    thinkingLevel: "HIGH",
    includeThoughts: true,
    futureOption: true,
  },
})
Image.generate({
  model: googleProvider,
  prompt: "A lighthouse",
  options: { aspectRatio: "future-ratio", imageSize: "8K", thinkingLevel: "FUTURE" },
})
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
Google.configure({ image: { providerOptions: { imageSize: "2K" } } })
// @ts-expect-error Known Google string options retain their value kind.
Image.generate({ model: googleProvider, prompt: "A lighthouse", options: { imageSize: 2 } })
// @ts-expect-error Known Google numeric options retain their value kind.
Image.generate({ model: googleProvider, prompt: "A lighthouse", options: { seed: "42" } })
// @ts-expect-error Known Google boolean options retain their value kind.
Image.generate({ model: googleProvider, prompt: "A lighthouse", options: { includeThoughts: "yes" } })

const openai = OpenAI.image("gpt-image-2")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
OpenAI.configure({ image: { options: { quality: "medium" } } })
const futureOpenAIOptions: ImageModelOptions<typeof openai> = { quality: "future-quality" }
void futureOpenAIOptions
Image.generate({
  model: openai,
  prompt: "A lighthouse",
  options: { quality: "hd", outputFormat: "webp", size: "2048x2048", future_option: true },
})
Image.generate({ model: openai, prompt: "A lighthouse", options: { quality: "future-quality", size: "256x256" } })
Image.generate({ model: openai, prompt: "A lighthouse", options: { size: "1792x1024" } })
Image.generate({ model: openai, prompt: "A lighthouse", options: { native_future_option: true } })
// @ts-expect-error Known OpenAI string options retain their value kind.
Image.generate({ model: openai, prompt: "A lighthouse", options: { quality: 1 } })
// @ts-expect-error Known OpenAI numeric options retain their value kind.
Image.generate({ model: openai, prompt: "A lighthouse", options: { outputCompression: "80" } })
OpenAI.imageGeneration({ action: "future-action", quality: "future-quality", size: "2048x2048" })
// @ts-expect-error Hosted image generation numeric options retain their value kind.
OpenAI.imageGeneration({ partialImages: "2" })
// @ts-expect-error Known Google-like options are inferred from the selected model.
Image.generate({ model: google, prompt: "A lighthouse", options: { aspectRatio: "wide" } })

const xai = XAI.configure({ apiKey: "test" }).image("any-model-id")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
XAI.configure({ image: { options: { resolution: "1k" } } })
Image.generate({
  model: xai,
  prompt: "A lighthouse",
  options: {
    n: 2,
    aspectRatio: "future-ratio",
    resolution: "future-resolution",
    responseFormat: "future-format",
    future_option: true,
  },
})
Image.generate({
  model: xai,
  prompt: "A lighthouse",
  options: { aspect_ratio: "16:9", response_format: "b64_json", native_future_option: true },
})
// @ts-expect-error Known xAI numeric options retain their value kind.
Image.generate({ model: xai, prompt: "A lighthouse", options: { n: "2" } })
// @ts-expect-error Known xAI string options retain their value kind.
Image.generate({ model: xai, prompt: "A lighthouse", options: { resolution: 2 } })

const zai = ZAI.configure({ apiKey: "test" }).image("any-model-id")
// @ts-expect-error Image generation options are request-scoped, not provider configuration.
ZAI.configure({ image: { options: { quality: "hd" } } })
Image.generate({
  model: zai,
  prompt: "A lighthouse",
  options: { quality: "future-quality", userID: "user-123", future_option: true },
})
Image.generate({ model: zai, prompt: "A lighthouse", options: { user_id: "raw-user" } })
// @ts-expect-error Known Z.ai string options retain their value kind.
Image.generate({ model: zai, prompt: "A lighthouse", options: { quality: 1 } })
// @ts-expect-error Known Z.ai user IDs retain their value kind.
Image.generate({ model: zai, prompt: "A lighthouse", options: { userID: 1 } })

declare const generic: ImageModel<ImageOptions>
Image.generate({ model: generic, prompt: "A lighthouse", options: { arbitrary: true } })

const request = Image.request({
  model: google,
  prompt: "A lighthouse",
  options: { aspectRatio: "1:1", futureOption: true },
})
const typedRequest: ImageRequestFor<GoogleLikeOptions> = request
void typedRequest

// @ts-expect-error Image requests no longer expose a common count option.
Image.generate({ model: openai, prompt: "A lighthouse", count: 2 })
// @ts-expect-error Image requests no longer expose a common size option.
Image.generate({ model: openai, prompt: "A lighthouse", size: { width: 1024, height: 1024 } })
// @ts-expect-error Image requests no longer expose a common aspectRatio option.
Image.generate({ model: openai, prompt: "A lighthouse", aspectRatio: "16:9" })
// @ts-expect-error Image requests no longer expose a common seed option.
Image.generate({ model: openai, prompt: "A lighthouse", seed: 1 })
// @ts-expect-error Image requests do not expose metadata.
Image.generate({ model: openai, prompt: "A lighthouse", metadata: { trace: true } })
