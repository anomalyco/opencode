import { Effect } from "effect"
import {
  Generation,
  Media,
  Video,
  VideoClient,
  VideoModel,
  VideoResponse,
  type VideoModelOptions,
  type VideoOptions,
  type VideoRequestFor,
} from "../src/index.js"
import type { Service } from "../src/video-client.js"
import { Anthropic, Fal, Google, OpenAI, Runway, XAI } from "../src/providers.js"

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type Success<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

type VeoLikeOptions = {
  readonly personGeneration?: "allow_all" | "allow_adult"
} & Record<string, unknown>

declare const veo: VideoModel<VeoLikeOptions>
// @ts-expect-error Extracted model options retain known provider fields.
const invalidVeoOptions: VideoModelOptions<typeof veo> = { personGeneration: "everyone" }
void invalidVeoOptions

Video.generate(
  {
    model: veo,
    prompt: "A kitten",
    frames: {
      first: Media.bytes(Uint8Array.from([1]), "image/png"),
      last: Media.fromDataUrl("data:image/png;base64,AQID"),
    },
    references: [Media.bytes(Uint8Array.from([1]), "image/png")],
    durationSeconds: 8,
    aspectRatio: "16:9",
    resolution: "1080p",
    audio: true,
    seed: 7,
    negativePrompt: "text",
    providerOptions: { personGeneration: "allow_adult", futureOption: true },
  },
  { poll: { interval: "10 seconds", timeout: "10 minutes" } },
)

const google = Google.configure({ apiKey: "test" }).video("veo-3.1-generate-preview")
Video.start({ model: google, prompt: "A kitten", providerOptions: { personGeneration: "future-value" } })
// @ts-expect-error Known Google string options retain their value kind.
Video.start({ model: google, prompt: "A kitten", providerOptions: { personGeneration: 1 } })
Video.generate({ model: google, prompt: "A kitten", resolution: "future-resolution" })

const xai = XAI.configure({ apiKey: "test" }).video("grok-imagine-video-1.5")
Video.start({
  model: xai,
  prompt: "Waves",
  video: Media.url("https://example.com/in.mp4"),
  providerOptions: { mode: "extend", reference_audios: [{ voice_id: "eve" }], future_option: true },
})
// @ts-expect-error xAI modes are a closed set because the route selects an endpoint from them.
Video.start({ model: xai, prompt: "Waves", providerOptions: { mode: "remix" } })

const fal = Fal.configure({ apiKey: "test" }).video("fal-ai/veo3.1")
Video.start({ model: fal, prompt: "Interview", providerOptions: { duration: "8s", safety_tolerance: "4" } })
Video.start({ model: fal, prompt: "Interview", providerOptions: { duration: "future-duration" } })
// @ts-expect-error Known fal string options retain their value kind.
Video.start({ model: fal, prompt: "Interview", providerOptions: { duration: 8 } })

const runway = Runway.configure({ apiKey: "test" }).video("gen4.5")
Video.start({
  model: runway,
  prompt: "Kite",
  aspectRatio: "1280:720",
  providerOptions: { contentModeration: { publicFigureThreshold: "low" }, outputFormat: "future-format" },
})
// @ts-expect-error Known Runway nested options retain their value kind.
Video.start({ model: runway, prompt: "Kite", providerOptions: { contentModeration: { publicFigureThreshold: 1 } } })

// @ts-expect-error Known Veo-like options are inferred from the selected model.
Video.generate({ model: veo, prompt: "A kitten", providerOptions: { personGeneration: "everyone" } })

// @ts-expect-error Language models cannot be used for video requests.
Video.generate({ model: Anthropic.configure({ apiKey: "test" }).model("claude-sonnet-4-5"), prompt: "A kitten" })
// @ts-expect-error Image models cannot be used for video requests.
Video.generate({ model: OpenAI.configure({ apiKey: "test" }).image("gpt-image-2"), prompt: "A kitten" })

// @ts-expect-error Frames are media assets, not strings.
Video.generate({ model: google, prompt: "A kitten", frames: { first: "https://example.com/first.png" } })
// @ts-expect-error Aspect ratios are `${w}:${h}` strings.
Video.generate({ model: google, prompt: "A kitten", aspectRatio: "wide" })
// @ts-expect-error Durations are numbers of seconds.
Video.generate({ model: google, prompt: "A kitten", durationSeconds: "8s" })
// @ts-expect-error Provider-native controls live under `providerOptions`.
Video.generate({ model: google, prompt: "A kitten", options: { personGeneration: "allow_all" } })

declare const generic: VideoModel<VideoOptions>
const widenVideo = <Options extends VideoOptions>(model: VideoModel<Options>): VideoModel => model
void widenVideo
Video.generate({ model: generic, prompt: "A kitten", providerOptions: { arbitrary: true } })

const request = Video.request({ model: veo, prompt: "A kitten", providerOptions: { personGeneration: "allow_all" } })
const typedRequest: VideoRequestFor<VeoLikeOptions> = request
void typedRequest
const started = VideoClient.start(request)
type StartRequirements = Assert<Equal<Requirements<typeof started>, Service>>
type StartSuccess = Assert<Equal<Success<typeof started>, Generation<VideoResponse>>>
void (true satisfies StartRequirements)
void (true satisfies StartSuccess)

const resumed = Video.resume(google, { operation: "models/veo/operations/op" })
type ResumeSuccess = Assert<Equal<Success<typeof resumed>, Generation<VideoResponse>>>
void (true satisfies ResumeSuccess)
