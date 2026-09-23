import { Effect, Schema } from "effect"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { SpeechStream } from "./utils/speech-stream.js"

const ADAPTER = "elevenlabs-speech"
const NAME = "ElevenLabs"
const PROVIDER = ProviderID.make("elevenlabs")
export const DEFAULT_BASE_URL = "https://api.elevenlabs.io"
export const PATH = "/v1/text-to-speech"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type ElevenLabsSpeechString<Known extends string> = Known | (string & {})

export type ElevenLabsOutputFormat = ElevenLabsSpeechString<
  | "mp3_22050_32"
  | "mp3_24000_48"
  | "mp3_44100_32"
  | "mp3_44100_64"
  | "mp3_44100_96"
  | "mp3_44100_128"
  | "mp3_44100_192"
  | "pcm_8000"
  | "pcm_16000"
  | "pcm_22050"
  | "pcm_24000"
  | "pcm_32000"
  | "pcm_44100"
  | "pcm_48000"
  | "wav_8000"
  | "wav_16000"
  | "wav_22050"
  | "wav_24000"
  | "wav_32000"
  | "wav_44100"
  | "wav_48000"
  | "ulaw_8000"
  | "alaw_8000"
  | "opus_48000_32"
  | "opus_48000_64"
  | "opus_48000_96"
  | "opus_48000_128"
  | "opus_48000_192"
>

/**
 * Provider-native options. Common fields lower to ElevenLabs names: `voice` → the path voice id, `language` →
 * `language_code`, `speed` → `voice_settings.speed`, `format` → the `output_format` query parameter (overridden by
 * `outputFormat`, the exact `codec_sampleRate_bitrate` string), and `timestamps` → the `with-timestamps` endpoints.
 */
export type ElevenLabsSpeechOptions = {
  readonly outputFormat?: ElevenLabsOutputFormat
  readonly voice_settings?: {
    readonly stability?: number
    readonly similarity_boost?: number
    readonly style?: number
    readonly use_speaker_boost?: boolean
  }
  readonly seed?: number
  readonly apply_text_normalization?: ElevenLabsSpeechString<"auto" | "on" | "off">
} & Record<string, unknown>

export type Request = SpeechRequestFor<ElevenLabsSpeechOptions>

// ---------------------------------------------------------------------------
// 3. Streaming event schema
// ---------------------------------------------------------------------------

const Alignment = Schema.Struct({
  characters: Schema.Array(Schema.String),
  character_start_times_seconds: Schema.Array(Schema.Number),
  character_end_times_seconds: Schema.Array(Schema.Number),
})

/** One `with-timestamps` document, and one record of the `stream/with-timestamps` NDJSON stream. */
const TimestampedAudio = Schema.Struct({
  audio_base64: Schema.Uint8ArrayFromBase64,
  alignment: optionalNull(Alignment),
})

const decodeRecord = MediaProtocol.decodeFrame(ADAPTER, NAME, TimestampedAudio)

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

type State = SpeechStream.Audio

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** Default `output_format` per common `format`; WAV is served only by the non-streaming endpoints. */
const OUTPUT_FORMATS: Readonly<Record<string, string>> = {
  mp3: "mp3_44100_128",
  pcm: "pcm_24000",
  wav: "wav_24000",
  opus: "opus_48000_64",
}

/** The `output_format` query value; WAV is served only by the non-streaming endpoints. */
const outputFormat = Effect.fn("ElevenLabsSpeech.outputFormat")(function* (request: MediaProtocol.Addressed<Request>) {
  const format = request.providerOptions?.outputFormat ?? OUTPUT_FORMATS[request.format ?? "mp3"]
  if (format === undefined)
    return yield* SpeechStream.unsupportedFormat(
      PROVIDER,
      ADAPTER,
      `${NAME} has no default output format for "${request.format}"; pass providerOptions.outputFormat`,
    )
  if (request.mode === "stream" && format.startsWith("wav_"))
    return yield* SpeechStream.unsupportedFormat(
      PROVIDER,
      ADAPTER,
      `${NAME} streams mp3, pcm, opus, ulaw, and alaw but not "${format}"; use generate for WAV`,
    )
  return format
})

const fromRequest = Effect.fn("ElevenLabsSpeech.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  if (request.voice === undefined)
    return yield* ProviderShared.invalidRequest(`${NAME} requires a voice id; pass it as \`voice\``)
  const { outputFormat: _outputFormat, ...native } = request.providerOptions ?? {}
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        text: request.text,
        model_id: request.model.id,
        language_code: request.language,
        voice_settings: request.speed === undefined ? undefined : { speed: request.speed },
      },
      native,
      request.http?.body,
    ) ?? {},
    { output_format: yield* outputFormat(request) },
  )
})

// `/stream` answers with chunked audio; `with-timestamps` answers with JSON carrying base64 audio and alignment.
const path = (request: MediaProtocol.Addressed<Request>) =>
  `${PATH}/${encodeURIComponent(SpeechStream.voiceID(request.voice) ?? "")}${request.mode === "stream" ? "/stream" : ""}${
    request.timestamps === true ? "/with-timestamps" : ""
  }`

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const onRecord = Effect.fn("ElevenLabsSpeech.onRecord")(function* (state: State, frame: string) {
  const record = yield* decodeRecord(frame)
  const [next, events] = SpeechStream.delta(state, record.audio_base64)
  const alignment = record.alignment
  if (!alignment) return [next, events] as const
  return [
    next,
    [
      ...events,
      ...SpeechStream.timestamps(
        alignment.characters,
        alignment.character_start_times_seconds,
        alignment.character_end_times_seconds,
      ),
    ],
  ] as const
})

const PCM_CODECS: Readonly<Record<string, SpeechStream.PcmEncoding>> = {
  pcm: "pcm_s16le",
  ulaw: "pcm_mulaw",
  alaw: "pcm_alaw",
}

/** `codec_sampleRate[_bitrate]` → declared media type and, for headerless codecs, the PCM facts. */
const describeOutput = (format: string) => {
  const [codec = format, rate] = format.split("_")
  const sampleRate = rate === undefined ? undefined : Number(rate)
  const encoding = PCM_CODECS[codec]
  return encoding === undefined ? SpeechStream.container(codec, sampleRate) : SpeechStream.pcm(encoding, sampleRate)
}

const finish = Effect.fn("ElevenLabsSpeech.finish")(function* (
  state: State,
  context: MediaProtocol.ResponseContext<Request>,
) {
  const requestID = context.http.headers["request-id"]
  return yield* SpeechStream.finish(ADAPTER, state, {
    ...describeOutput(yield* outputFormat(context.request)),
    // `character-cost` is billed credits, not a character count (3 for 20 characters on `eleven_flash_v2_5`).
    usage: SpeechStream.headerUsage("credits", context.http.headers["character-cost"]),
    providerMetadata: requestID === undefined ? undefined : { elevenlabs: { requestId: requestID } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, string | Uint8Array, State>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["instructions"],
  body: { from: fromRequest },
  frames: (bytes, context) => {
    if (context.request.timestamps !== true) return bytes
    return context.request.mode === "stream" ? Framing.lines.frame(bytes) : Framing.document.frame(bytes)
  },
  initial: () => ({ chunks: [] }),
  step: SpeechStream.step(onRecord),
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<ElevenLabsSpeechOptions, string | Uint8Array, State>(
    { id: ADAPTER, provider: PROVIDER, protocol, baseURL: DEFAULT_BASE_URL, path: ({ request }) => path(request) },
    input,
  )

export const ElevenLabsSpeech = {
  protocol,
  model,
} as const
