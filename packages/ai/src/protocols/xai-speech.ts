import { Effect } from "effect"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { SpeechStream } from "./utils/speech-stream.js"

const route = MediaProtocol.identity({ id: "xai-speech", name: "xAI Speech", provider: "xai" })
export const DEFAULT_BASE_URL = "https://api.x.ai/v1"
export const PATH = "/tts"
const DEFAULT_SAMPLE_RATE = 24000

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** `voice`, `format`, `speed`, and `language` are common request fields; other native body fields pass through. */
export type XAISpeechOptions = {
  readonly sampleRate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000
  /** MP3 only. */
  readonly bitRate?: 32000 | 64000 | 96000 | 128000 | 192000
  readonly optimize_streaming_latency?: number
  readonly text_normalization?: boolean
  readonly replace?: Readonly<Record<string, string>>
} & Record<string, unknown>

export type Request = SpeechRequestFor<XAISpeechOptions>

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

type State = SpeechStream.Audio

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** `output_format.codec` values; headerless codecs map to the PCM encoding of their samples. */
const CODECS = new Map<string, SpeechStream.PcmEncoding | undefined>([
  ["mp3", undefined],
  ["wav", undefined],
  ["pcm", "pcm_s16le"],
  ["mulaw", "pcm_mulaw"],
  ["alaw", "pcm_alaw"],
])

const outputFormat = Effect.fn("XAISpeech.outputFormat")(function* (request: Request) {
  const codec = request.format ?? "mp3"
  if (!CODECS.has(codec))
    return yield* route.unsupported(
      "media.format",
      `${route.name} supports the mp3, wav, pcm, mulaw, and alaw formats, not "${codec}"`,
    )
  return { codec, sample_rate: request.providerOptions?.sampleRate, bit_rate: request.providerOptions?.bitRate }
})

// The TTS API has no model field, so the selected model id only names the model.
const fromRequest = Effect.fn("XAISpeech.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  const { sampleRate: _sampleRate, bitRate: _bitRate, ...native } = request.providerOptions ?? {}
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        text: request.text,
        voice_id: SpeechStream.voiceID(request.voice),
        // `language` is required; `auto` detects it from the text.
        language: request.language ?? "auto",
        output_format: yield* outputFormat(request),
        speed: request.speed,
      },
      native,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const finish = Effect.fn("XAISpeech.finish")(function* (state: State, context: MediaProtocol.ResponseContext<Request>) {
  const format = yield* outputFormat(context.request)
  const sampleRate = format.sample_rate ?? DEFAULT_SAMPLE_RATE
  const encoding = CODECS.get(format.codec)
  return yield* SpeechStream.finish(
    route,
    state,
    encoding === undefined ? SpeechStream.container(format.codec, sampleRate) : SpeechStream.pcm(encoding, sampleRate),
  )
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

/** The response body is the raw audio in both modes, so `stream` forwards body chunks as they arrive. */
export const protocol = MediaProtocol.stream<Request, SpeechEvent, Uint8Array, State>(route, {
  unsupported: ["instructions", "timestamps"],
  body: { from: fromRequest },
  frames: (bytes) => bytes,
  initial: () => ({ chunks: [] }),
  step: (state, frame) => Effect.succeed(SpeechStream.delta(state, frame)),
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<XAISpeechOptions, Uint8Array, State>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const XAISpeech = {
  protocol,
  model,
} as const
