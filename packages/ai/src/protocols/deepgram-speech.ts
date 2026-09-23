import { Effect } from "effect"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { SpeechStream } from "./utils/speech-stream.js"

const ADAPTER = "deepgram-speech"
const NAME = "Deepgram"
const PROVIDER = ProviderID.make("deepgram")
export const DEFAULT_BASE_URL = "https://api.deepgram.com"
export const PATH = "/v1/speak"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type DeepgramSpeechString<Known extends string> = Known | (string & {})

export type DeepgramEncoding = DeepgramSpeechString<"linear16" | "mulaw" | "alaw" | "mp3" | "opus" | "flac" | "aac">

/**
 * Provider-native options, sent as query parameters. The voice is the model id (`aura-2-thalia-en`), so `voice` and
 * `language` are rejected. `format` selects `encoding`/`container`; `encoding`, `container`, `sampleRate`, and
 * `bitRate` override it, and other primitive entries (`mip_opt_out`, `tag`) pass through as query parameters.
 */
export type DeepgramSpeechOptions = {
  readonly encoding?: DeepgramEncoding
  readonly container?: DeepgramSpeechString<"wav" | "ogg" | "none">
  readonly sampleRate?: number
  readonly bitRate?: number
  readonly mip_opt_out?: boolean
  readonly tag?: string
} & Record<string, unknown>

export type Request = SpeechRequestFor<DeepgramSpeechOptions>

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

type State = SpeechStream.Audio

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const FORMATS: Readonly<Record<string, { readonly encoding: string; readonly container?: string }>> = {
  mp3: { encoding: "mp3" },
  wav: { encoding: "linear16", container: "wav" },
  pcm: { encoding: "linear16", container: "none" },
  opus: { encoding: "opus" },
  flac: { encoding: "flac" },
  aac: { encoding: "aac" },
}

const queryValue = (value: unknown) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : undefined

const queryParameters = (request: Request) => {
  const format = request.format === undefined ? undefined : FORMATS[request.format]
  const { encoding, container, sampleRate, bitRate, ...native } = request.providerOptions ?? {}
  return Object.fromEntries(
    Object.entries({
      ...native,
      model: request.model.id,
      encoding: encoding ?? format?.encoding,
      container: container ?? format?.container,
      sample_rate: sampleRate,
      bit_rate: bitRate,
      speed: request.speed,
    }).flatMap(([key, value]) => {
      const text = queryValue(value)
      return text === undefined ? [] : [[key, text]]
    }),
  )
}

const fromRequest = Effect.fn("DeepgramSpeech.fromRequest")(function* (request: Request) {
  if (
    request.format !== undefined &&
    FORMATS[request.format] === undefined &&
    request.providerOptions?.encoding === undefined
  )
    return yield* SpeechStream.unsupportedFormat(
      PROVIDER,
      ADAPTER,
      `${NAME} has no encoding for format "${request.format}"; pass providerOptions.encoding`,
    )
  return MediaProtocol.json(
    mergeJsonRecords({ text: request.text }, request.http?.body) ?? {},
    queryParameters(request),
  )
})

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const HEADERLESS_ENCODINGS: Readonly<Record<string, SpeechStream.PcmEncoding>> = {
  linear16: "pcm_s16le",
  mulaw: "pcm_mulaw",
  alaw: "pcm_alaw",
}

// Deepgram declares every output's content type, including headerless PCM (`audio/l16;rate=24000`).
const finish = (state: State, context: MediaProtocol.ResponseContext<Request>) => {
  const headers = context.http.headers
  const mediaType = headers["content-type"]
  const query = queryParameters(context.request)
  const encoding = HEADERLESS_ENCODINGS[query.encoding ?? ""]
  const requestID = headers["dg-request-id"]
  const modelName = headers["dg-model-name"]
  return SpeechStream.finish(ADAPTER, state, {
    ...(query.container === "none" && encoding !== undefined
      ? SpeechStream.pcm(encoding, SpeechStream.sampleRate(mediaType), mediaType)
      : // Deepgram's default encoding is MP3; WAV is a container around any encoding.
        { mediaType, info: { format: query.container === "wav" ? "wav" : (query.encoding ?? "mp3") } }),
    usage: SpeechStream.headerUsage("characters", headers["dg-char-count"]),
    providerMetadata:
      requestID === undefined && modelName === undefined
        ? undefined
        : { deepgram: { requestId: requestID, modelName } },
  })
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, Uint8Array, State>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["voice", "language", "instructions", "timestamps"],
  body: { from: fromRequest },
  frames: (bytes) => bytes,
  initial: () => ({ chunks: [] }),
  step: (state, frame) => Effect.succeed(SpeechStream.delta(state, frame)),
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<DeepgramSpeechOptions, Uint8Array, State>(
    { id: ADAPTER, provider: PROVIDER, protocol, baseURL: DEFAULT_BASE_URL, path: PATH },
    input,
  )

export const DeepgramSpeech = {
  protocol,
  model,
} as const
