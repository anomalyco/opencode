import { Effect } from "effect"
import { Generation, Media } from "../src/effect.js"
import {
  Video,
  VideoClient,
  VideoModel,
  VideoResponse,
  type VideoModelOptions,
  type VideoOptions,
  type VideoRequest,
} from "../src/experimental.js"
import type { Service } from "../src/video-client.js"
import { Anthropic, OpenAI, XAI } from "../src/providers.js"

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type Success<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

type CustomOptions = {
  readonly personGeneration?: "allow_all" | "allow_adult"
} & Record<string, unknown>

declare const custom: VideoModel<CustomOptions>
// @ts-expect-error Extracted model options retain known provider fields.
const invalidCustomOptions: VideoModelOptions<typeof custom> = { personGeneration: "everyone" }
void invalidCustomOptions

Video.generate(
  {
    model: custom,
    prompt: "A kitten",
    frames: {
      first: Media.bytes(Uint8Array.from([1]), "image/png"),
      last: Media.fromDataUrl("data:image/png;base64,AQID"),
    },
    references: [Media.bytes(Uint8Array.from([1]), "image/png")],
    durationSeconds: 8,
    aspect: "16:9",
    resolution: "1080p",
    audio: true,
    seed: 7,
    negativePrompt: "text",
    providerOptions: { personGeneration: "allow_adult", futureOption: true },
  },
  { poll: { interval: "10 seconds", timeout: "10 minutes" } },
)

const xai = XAI.configure({ apiKey: "test" }).video("grok-imagine-video-1.5")
Video.start({
  model: xai,
  prompt: "Waves",
  video: Media.url("https://example.com/in.mp4"),
  providerOptions: { mode: "extend", reference_audios: [{ voice_id: "eve" }], future_option: true },
})
// @ts-expect-error xAI modes are a closed set because the route selects an endpoint from them.
Video.start({ model: xai, prompt: "Waves", providerOptions: { mode: "remix" } })
// @ts-expect-error Known xAI nested options retain their value kind.
Video.start({ model: xai, prompt: "Waves", providerOptions: { reference_audios: [{ voice_id: 1 }] } })
Video.generate({ model: xai, prompt: "Waves", resolution: "future-resolution" })

// @ts-expect-error Known custom options are inferred from the selected model.
Video.generate({ model: custom, prompt: "A kitten", providerOptions: { personGeneration: "everyone" } })

// @ts-expect-error Language models cannot be used for video requests.
Video.generate({ model: Anthropic.configure({ apiKey: "test" }).model("claude-sonnet-4-5"), prompt: "A kitten" })
// @ts-expect-error Image models cannot be used for video requests.
Video.generate({ model: OpenAI.configure({ apiKey: "test" }).image("gpt-image-2"), prompt: "A kitten" })

// @ts-expect-error Frames are media assets, not strings.
Video.generate({ model: xai, prompt: "A kitten", frames: { first: "https://example.com/first.png" } })
// @ts-expect-error Aspect ratios are `${w}:${h}` strings.
Video.generate({ model: xai, prompt: "A kitten", aspect: "wide" })
// @ts-expect-error Durations are numbers of seconds.
Video.generate({ model: xai, prompt: "A kitten", durationSeconds: "8s" })
// @ts-expect-error Provider-native controls live under `providerOptions`.
Video.generate({ model: xai, prompt: "A kitten", options: { mode: "extend" } })

declare const generic: VideoModel<VideoOptions>
const widenVideo = <Options extends VideoOptions>(model: VideoModel<Options>): VideoModel => model
void widenVideo
Video.generate({ model: generic, prompt: "A kitten", providerOptions: { arbitrary: true } })

const request = Video.request({ model: custom, prompt: "A kitten", providerOptions: { personGeneration: "allow_all" } })
const typedRequest: VideoRequest<VideoModel<CustomOptions>> = request
void typedRequest
const started = VideoClient.start(request)
type StartRequirements = Assert<Equal<Requirements<typeof started>, Service>>
type StartSuccess = Assert<Equal<Success<typeof started>, Generation<VideoResponse>>>
void (true satisfies StartRequirements)
void (true satisfies StartSuccess)

const resumed = Video.resume(xai, { requestID: "req_1" })
type ResumeSuccess = Assert<Equal<Success<typeof resumed>, Generation<VideoResponse>>>
void (true satisfies ResumeSuccess)
