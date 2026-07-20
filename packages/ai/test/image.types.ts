import {
  Image,
  ImageModel,
  type ImageModelOptions,
  type ImageOptions,
  type ImageRequestFor,
  type ImageRoute,
} from "../src"
import { OpenAI } from "../src/providers"

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

const openai = OpenAI.image("gpt-image-2")
// @ts-expect-error Extracted model options retain known provider fields.
const invalidOpenAIOptions: ImageModelOptions<typeof openai> = { quality: "ultra" }
void invalidOpenAIOptions
Image.generate({
  model: openai,
  prompt: "A lighthouse",
  options: { quality: "high", outputFormat: "webp", future_option: true },
})
// @ts-expect-error Known OpenAI options retain their provider-specific value types.
Image.generate({ model: openai, prompt: "A lighthouse", options: { quality: "ultra" } })
// @ts-expect-error Known Google-like options are inferred from the selected model.
Image.generate({ model: google, prompt: "A lighthouse", options: { aspectRatio: "wide" } })

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
