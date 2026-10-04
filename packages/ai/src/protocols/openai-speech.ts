import { Effect, Schema } from "effect"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type MediaUsage } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { SpeechStream } from "./utils/speech-stream.js"

const route = MediaProtocol.identity({ id: "openai-speech", name: "OpenAI Speech", provider: "openai" })
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/audio/speech"
/** `pcm` is raw 24 kHz, 16-bit signed little-endian mono samples without a header. */
const PCM_SAMPLE_RATE = 24000

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** `voice`, `instructions`, `speed`, and `format` are common request fields; other native body fields pass through. */
export type OpenAISpeechOptions = {
  /** Defaults to `"sse"` in `stream` mode on models that support it; the merged value selects the response framing. */
  readonly stream_format?: "sse" | "audio"
} & Record<string, unknown>

export type Request = SpeechRequestFor<OpenAISpeechOptions>

// ---------------------------------------------------------------------------
// 3. Streaming event schema
// ---------------------------------------------------------------------------

const SpeechStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("speech.audio.delta"), audio: Schema.Uint8ArrayFromBase64 }),
  Schema.Struct({
    type: Schema.Literal("speech.audio.done"),
    usage: Schema.optional(
      Schema.Struct({
        input_tokens: Schema.optional(Schema.Number),
        output_tokens: Schema.optional(Schema.Number),
        total_tokens: Schema.optional(Schema.Number),
      }),
    ),
  }),
])

const decodeEvent = route.decodeFrame(SpeechStreamEvent)

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

interface State extends SpeechStream.Audio {
  readonly done: boolean
  readonly usage?: MediaUsage
}

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

// `sse` is not supported for `tts-1` or `tts-1-hd`; those models stream the raw audio body instead.
const supportsSse = (model: string) => !/^tts-1(-hd)?(-|$)/.test(model)

const FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"])

const fromRequest = Effect.fn("OpenAISpeech.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  // Not in `unsupported`: that list would also reject `timestamps: false`, which asks for nothing.
  if (request.timestamps === true)
    return yield* route.unsupported("media.timestamps", `${route.name} does not return timestamps`)
  if (request.format !== undefined && !FORMATS.has(request.format))
    return yield* route.unsupported(
      "media.format",
      `${route.name} supports the mp3, opus, aac, flac, wav, and pcm formats, not "${request.format}"`,
    )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        input: request.text,
        voice: request.voice,
        instructions: request.instructions,
        response_format: request.format,
        speed: request.speed,
        stream_format: request.mode === "stream" && supportsSse(request.model.id) ? "sse" : undefined,
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const isSse = (body: MediaProtocol.Body) => body.type === "json" && body.value.stream_format === "sse"

const onEvent = Effect.fn("OpenAISpeech.onEvent")(function* (state: State, frame: string) {
  const event = yield* decodeEvent(frame)
  if (event.type === "speech.audio.delta") return SpeechStream.delta(state, event.audio)
  const usage = event.usage
  return [
    {
      ...state,
      done: true,
      usage:
        usage === undefined
          ? undefined
          : {
              type: "tokens" as const,
              input: usage.input_tokens,
              output: usage.output_tokens,
              total: usage.total_tokens,
              details: { openai: usage },
            },
    },
    [],
  ] as const
})

const finish = (state: State, context: MediaProtocol.ResponseContext<Request>) => {
  if (isSse(context.body) && !state.done) return Effect.fail(route.incomplete())
  // The sent body reflects `providerOptions` and `http.body` overrides of `format`.
  const sent = context.body.type === "json" ? context.body.value.response_format : undefined
  const format = typeof sent === "string" ? sent : "mp3"
  return SpeechStream.finish(route, state, {
    ...(format === "pcm" ? SpeechStream.pcm("pcm_s16le", PCM_SAMPLE_RATE) : SpeechStream.container(format)),
    usage: state.usage,
  })
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, string | Uint8Array, State>(route, {
  unsupported: ["language"],
  body: { from: fromRequest },
  frames: (bytes, context) => (isSse(context.body) ? Framing.sse.frame(bytes) : bytes),
  initial: () => ({ chunks: [], done: false }),
  step: SpeechStream.step(onEvent),
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<OpenAISpeechOptions, string | Uint8Array, State>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: PATH },
    input,
  )

export const OpenAISpeech = {
  protocol,
  model,
} as const
