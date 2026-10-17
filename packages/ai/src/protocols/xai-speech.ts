import { Effect } from "effect"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { isRecord } from "../utils/record.js"
import { SpeechStream } from "./utils/speech-stream.js"

const route = MediaProtocol.identity({ id: "xai-speech", name: "xAI Speech", provider: "xai" })
export const DEFAULT_BASE_URL = "https://api.x.ai/v1"
export const PATH = "/tts"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native body fields (speech tags, `text_normalization`, `replace`, …) pass through. */
export type XAISpeechOptions = Record<string, unknown>

export type Request = SpeechRequestFor<XAISpeechOptions>

// The request names no model; the caller's model id only selects this route.

// ---------------------------------------------------------------------------
// 2. Parser state
// ---------------------------------------------------------------------------

/** xAI answers with the audio body itself, so `stream` and `generate` share the delta accumulator. */
type State = SpeechStream.Audio

// ---------------------------------------------------------------------------
// 3. Request body construction
// ---------------------------------------------------------------------------

// Output codecs the API documents; `opus`, `aac`, and `flac` are not produced.
const CODECS = new Set(["mp3", "wav", "pcm", "mulaw", "alaw"])

/** Headerless codecs need a rate to be playable; the API's documented default is 24 kHz. */
const DEFAULT_SAMPLE_RATE = 24000

const fromRequest = Effect.fn("XAISpeech.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  // `timestamps: false` asks for nothing and is not rejected.
  if (request.timestamps === true)
    return yield* route.unsupported("media.timestamps", `${route.name} does not return timestamps on this route`)
  if (request.format !== undefined && !CODECS.has(request.format))
    return yield* route.unsupported(
      "media.format",
      `${route.name} supports the mp3, wav, pcm, mulaw, and alaw formats, not "${request.format}"`,
    )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        text: request.text,
        voice_id: SpeechStream.voiceID(request.voice),
        // The API requires a language; `auto` keeps automatic detection for callers that do not pick one.
        language: request.language ?? "auto",
        output_format: request.format === undefined ? undefined : { codec: request.format },
        speed: request.speed,
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 4. Response description
// ---------------------------------------------------------------------------

const finish = (state: State, context: MediaProtocol.ResponseContext<Request>) => {
  // The sent body reflects `providerOptions` and `http.body` overrides of the codec and rate.
  const sent = context.body.type === "json" ? context.body.value.output_format : undefined
  const codec = isRecord(sent) && typeof sent.codec === "string" ? sent.codec : "mp3"
  const sampleRate = isRecord(sent) && typeof sent.sample_rate === "number" ? sent.sample_rate : DEFAULT_SAMPLE_RATE
  return SpeechStream.finish(route, state, {
    ...(codec === "pcm"
      ? SpeechStream.pcm("pcm_s16le", sampleRate)
      : codec === "mulaw"
        ? SpeechStream.pcm("pcm_mulaw", sampleRate)
        : codec === "alaw"
          ? SpeechStream.pcm("pcm_alaw", sampleRate)
          : SpeechStream.container(codec)),
  })
}

// ---------------------------------------------------------------------------
// 5. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, Uint8Array, State>(route, {
  unsupported: ["instructions"],
  body: { from: fromRequest },
  frames: (bytes) => bytes,
  initial: () => ({ chunks: [] }),
  step: (state, frame) => Effect.succeed(SpeechStream.delta(state, frame)),
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<XAISpeechOptions, Uint8Array, State>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: PATH },
    input,
  )

export const XAISpeech = {
  protocol,
  model,
} as const
