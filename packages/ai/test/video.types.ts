import { Effect } from "effect"
import {
  Media,
  VideoClient,
  VideoModel,
  VideoResponse,
  ai,
  type VideoJob,
  type VideoModelOptions,
  type VideoOptions,
  type VideoRequest,
  type VideoStatus,
} from "../src/effect.js"
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

ai.video.start({
  model: custom,
  prompt: "A kitten",
  start: Media.bytes(Uint8Array.from([1]), "image/png"),
  end: "data:image/png;base64,AQID",
  references: [Media.bytes(Uint8Array.from([1]), "image/png"), "https://example.com/voice.mp3"],
  duration: "8 seconds",
  aspect: "16:9",
  resolution: "1080p",
  sound: true,
  providerOptions: { personGeneration: "allow_adult", futureOption: true },
})
ai.video.start({ model: custom, prompt: "A kitten", duration: "1 second", aspect: "auto", resolution: "2k" })

const xai = XAI.configure({ apiKey: "test" }).video("grok-imagine-video-1.5")
ai.video.start({
  model: xai,
  prompt: "Waves",
  providerOptions: {
    mode: "extend",
    video: { url: "https://example.com/in.mp4" },
    reference_audios: [{ voice_id: "eve" }],
    future_option: true,
  },
})
// @ts-expect-error xAI modes are a closed set because the route selects an endpoint from them.
ai.video.start({ model: xai, prompt: "Waves", providerOptions: { mode: "remix" } })
// @ts-expect-error Known xAI nested options retain their value kind.
ai.video.start({ model: xai, prompt: "Waves", providerOptions: { reference_audios: [{ voice_id: 1 }] } })

// @ts-expect-error Known custom options are inferred from the selected model.
ai.video.start({ model: custom, prompt: "A kitten", providerOptions: { personGeneration: "everyone" } })

// @ts-expect-error Language models cannot be used for video requests.
ai.video.start({ model: Anthropic.configure({ apiKey: "test" }).model("claude-sonnet-4-5"), prompt: "A kitten" })
// @ts-expect-error Image models cannot be used for video requests.
ai.video.start({ model: OpenAI.configure({ apiKey: "test" }).image("gpt-image-2"), prompt: "A kitten" })

// @ts-expect-error Aspect ratios are `${w}:${h}` strings or "auto".
ai.video.start({ model: xai, prompt: "A kitten", aspect: "wide" })
// @ts-expect-error Durations are Effect duration strings in seconds, not numbers.
ai.video.start({ model: xai, prompt: "A kitten", duration: 8 })
// @ts-expect-error Durations are seconds for now.
ai.video.start({ model: xai, prompt: "A kitten", duration: "1 minute" })
// @ts-expect-error Sound is on or off.
ai.video.start({ model: xai, prompt: "A kitten", sound: "native" })
// @ts-expect-error The shared request has no seed; it lives under `providerOptions`.
ai.video.start({ model: xai, prompt: "A kitten", seed: 7 })
// @ts-expect-error Start and end replace `frames`.
ai.video.start({ model: xai, prompt: "A kitten", frames: { first: "https://example.com/first.png" } })

declare const generic: VideoModel<VideoOptions>
const widenVideo = <Options extends VideoOptions>(model: VideoModel<Options>): VideoModel => model
void widenVideo
ai.video.start({ model: generic, prompt: "A kitten", providerOptions: { arbitrary: true } })

const request = ai.video.request({
  model: custom,
  prompt: "A kitten",
  providerOptions: { personGeneration: "allow_all" },
})
const typedRequest: VideoRequest<VideoModel<CustomOptions>> = request
void typedRequest

const started = VideoClient.start(request)
type StartRequirements = Assert<Equal<Requirements<typeof started>, Service>>
type StartSuccess = Assert<Equal<Success<typeof started>, VideoJob>>
void (true satisfies StartRequirements)
void (true satisfies StartSuccess)

type StatusSuccess = Assert<Equal<Success<ReturnType<typeof ai.video.status>>, VideoStatus>>
type ResultSuccess = Assert<Equal<Success<ReturnType<typeof ai.video.result>>, VideoResponse>>
type CancelSuccess = Assert<Equal<Success<ReturnType<typeof ai.video.cancel>>, void>>
void (true satisfies StatusSuccess)
void (true satisfies ResultSuccess)
void (true satisfies CancelSuccess)
