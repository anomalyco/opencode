import { Effect, Schema } from "effect"
import { classifyProviderFailure } from "../provider-error.js"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { AIError, ProviderID, mergeJsonRecords } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { SpeechStream } from "./utils/speech-stream.js"

const ADAPTER = "cartesia-speech"
const NAME = "Cartesia"
const PROVIDER = ProviderID.make("cartesia")
export const DEFAULT_BASE_URL = "https://api.cartesia.ai"
export const API_VERSION = "2026-08-14"
export const BYTES_PATH = "/tts/bytes"
export const SSE_PATH = "/tts/sse"
const DEFAULT_SAMPLE_RATE = 44100
const DEFAULT_BIT_RATE = 128000

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type CartesiaSpeechString<Known extends string> = Known | (string & {})

export type CartesiaEncoding = SpeechStream.PcmEncoding

/**
 * Provider-native options. Common fields lower to Cartesia names: `voice` → `voice`, `language` → `language`,
 * `speed` → `generation_config.speed`, `format` → `output_format.container`, and `timestamps` → `add_timestamps`
 * on the SSE endpoint. `sampleRate`, `bitRate` (MP3), and `encoding` (raw and WAV) complete `output_format`.
 */
export type CartesiaSpeechOptions = {
  readonly sampleRate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000
  readonly bitRate?: 32000 | 64000 | 96000 | 128000 | 192000
  readonly encoding?: CartesiaEncoding
  readonly generation_config?: {
    readonly volume?: number
    readonly emotion?: CartesiaSpeechString<"neutral" | "calm" | "angry" | "content" | "sad" | "scared">
  }
  readonly pronunciation_dict_id?: string
} & Record<string, unknown>

export type Request = SpeechRequestFor<CartesiaSpeechOptions>

// ---------------------------------------------------------------------------
// 3. Streaming event schema
// ---------------------------------------------------------------------------

/** `chunk`, `timestamps`, `done`, and `error` records; `phoneme_timestamps` and future types are ignored. */
const SseEvent = Schema.Struct({
  type: Schema.String,
  data: Schema.optional(Schema.Uint8ArrayFromBase64),
  word_timestamps: Schema.optional(
    Schema.Struct({
      words: Schema.Array(Schema.String),
      start: Schema.Array(Schema.Number),
      end: Schema.Array(Schema.Number),
    }),
  ),
  status_code: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  error_code: optionalNull(Schema.String),
})

const decodeEvent = MediaProtocol.decodeFrame(ADAPTER, NAME, SseEvent)

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

interface State extends SpeechStream.Audio {
  /** SSE responses end with a `done` record; `/tts/bytes` ends when the body does. */
  readonly done: boolean
}

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** Timestamps exist only on the SSE endpoint, so a `generate` that asks for them collects an SSE stream. */
const usesSse = (request: MediaProtocol.Addressed<Request>) => request.mode === "stream" || request.timestamps === true

const CONTAINERS: Readonly<Record<string, "raw" | "wav" | "mp3">> = { pcm: "raw", wav: "wav", mp3: "mp3" }

const outputFormat = Effect.fn("CartesiaSpeech.outputFormat")(function* (request: MediaProtocol.Addressed<Request>) {
  const sse = usesSse(request)
  const format = request.format ?? (sse ? "pcm" : "mp3")
  const container = CONTAINERS[format]
  if (container === undefined)
    return yield* SpeechStream.unsupportedFormat(
      PROVIDER,
      ADAPTER,
      `${NAME} supports the pcm, wav, and mp3 formats, not "${format}"`,
    )
  if (sse && container !== "raw")
    return yield* SpeechStream.unsupportedFormat(
      PROVIDER,
      ADAPTER,
      `${NAME} streams and timestamps only raw PCM; request format "pcm" instead of "${format}"`,
    )
  const sampleRate = request.providerOptions?.sampleRate ?? DEFAULT_SAMPLE_RATE
  if (container === "mp3")
    return { container, sample_rate: sampleRate, bit_rate: request.providerOptions?.bitRate ?? DEFAULT_BIT_RATE }
  return { container, encoding: request.providerOptions?.encoding ?? "pcm_s16le", sample_rate: sampleRate }
})

const fromRequest = Effect.fn("CartesiaSpeech.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  const voice = SpeechStream.voiceID(request.voice)
  if (voice === undefined)
    return yield* ProviderShared.invalidRequest(`${NAME} requires a voice id; pass it as \`voice\``)
  const { sampleRate: _sampleRate, bitRate: _bitRate, encoding: _encoding, ...native } = request.providerOptions ?? {}
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model_id: request.model.id,
        transcript: request.text,
        voice,
        output_format: yield* outputFormat(request),
        language: request.language,
        generation_config: request.speed === undefined ? undefined : { speed: request.speed },
        add_timestamps: request.timestamps === true ? true : undefined,
      },
      native,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const onEvent = Effect.fn("CartesiaSpeech.onEvent")(function* (state: State, frame: string) {
  const event = yield* decodeEvent(frame)
  if (event.type === "chunk" && event.data !== undefined) return SpeechStream.delta(state, event.data)
  if (event.type === "timestamps" && event.word_timestamps !== undefined) {
    const words = event.word_timestamps
    return [state, SpeechStream.timestamps(words.words, words.start, words.end)] as const
  }
  if (event.type === "done") return [{ ...state, done: true }, []] as const
  if (event.type === "error")
    // `status_code` classifies the failure; the route attaches the observed HTTP response (200).
    return yield* new AIError({
      reason: classifyProviderFailure({
        message: `${NAME} stream failed${event.title === undefined ? "" : ` (${event.title})`}: ${event.message ?? "unknown error"}`,
        status: event.status_code,
        rawBody: frame,
      }),
    })
  return [state, []] as const
})

const finish = Effect.fn("CartesiaSpeech.finish")(function* (
  state: State,
  context: MediaProtocol.ResponseContext<Request>,
) {
  if (usesSse(context.request) && !state.done) return yield* MediaProtocol.incomplete(ADAPTER)
  const format = yield* outputFormat(context.request)
  return yield* SpeechStream.finish(
    ADAPTER,
    state,
    format.container === "raw"
      ? SpeechStream.pcm(format.encoding, format.sample_rate)
      : SpeechStream.container(format.container, format.sample_rate),
  )
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, string | Uint8Array, State>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["instructions"],
  body: { from: fromRequest },
  frames: (bytes, context) => (usesSse(context.request) ? Framing.sse.frame(bytes) : bytes),
  initial: () => ({ chunks: [], done: false }),
  step: SpeechStream.step(onEvent),
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<CartesiaSpeechOptions, string | Uint8Array, State>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      baseURL: DEFAULT_BASE_URL,
      headers: { "Cartesia-Version": API_VERSION },
      path: ({ request }) => (usesSse(request) ? SSE_PATH : BYTES_PATH),
    },
    input,
  )

export const CartesiaSpeech = {
  protocol,
  model,
} as const
