import { Effect, Schema, Stream } from "effect"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords, type MediaUsage } from "../schema/index.js"
import {
  TranscriptionFinishEvent,
  TranscriptionModel,
  TranscriptionSegmentEvent,
  TranscriptionTextDeltaEvent,
  type TranscriptionEvent,
  type TranscriptionRequestFor,
  type TranscriptionSegment,
} from "../transcription.js"
import { mediaTypeExtension } from "../utils/media-type.js"
import { ProviderShared } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const ADAPTER = "openai-transcription"
const NAME = "OpenAI Transcription"
const PROVIDER = ProviderID.make("openai")
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/audio/transcriptions"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type OpenAITranscriptionOptions = {
  readonly chunking_strategy?:
    | "auto"
    | {
        readonly type: "server_vad"
        readonly prefix_padding_ms?: number
        readonly silence_duration_ms?: number
        readonly threshold?: number
      }
  readonly include?: ReadonlyArray<"logprobs">
  readonly keywords?: ReadonlyArray<string>
  readonly known_speaker_names?: ReadonlyArray<string>
  readonly known_speaker_references?: ReadonlyArray<string>
  readonly temperature?: number
} & Record<string, unknown>

export type Request = TranscriptionRequestFor<OpenAITranscriptionOptions>

// ---------------------------------------------------------------------------
// 3. Streaming event schema
// ---------------------------------------------------------------------------

const Segment = Schema.Struct({
  text: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  speaker: Schema.optional(Schema.String),
})

const Usage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tokens"),
    input_tokens: Schema.optional(Schema.Number),
    output_tokens: Schema.optional(Schema.Number),
    total_tokens: Schema.optional(Schema.Number),
  }),
  Schema.Struct({ type: Schema.Literal("duration"), seconds: Schema.Number }),
])

const transcriptFields = {
  text: Schema.String,
  language: Schema.optional(Schema.String),
  languages: Schema.optional(Schema.Array(Schema.Struct({ code: Schema.String }))),
  duration: Schema.optional(Schema.Number),
  segments: Schema.optional(Schema.Array(Segment)),
  words: Schema.optional(
    Schema.Array(Schema.Struct({ word: Schema.String, start: Schema.Number, end: Schema.Number })),
  ),
  usage: Schema.optional(Usage),
}

const Event = Schema.Union([
  Schema.Struct({ type: Schema.Literal("transcript.text.delta"), delta: Schema.String }),
  Schema.Struct({ type: Schema.Literal("transcript.text.segment"), ...Segment.fields }),
  Schema.Struct({ type: Schema.Literal("transcript.text.done"), ...transcriptFields }),
])
const Transcript = Schema.Struct(transcriptFields)
type Transcript = Schema.Schema.Type<typeof Transcript>

const decodeEvent = MediaProtocol.decodeFrame(ADAPTER, NAME, Event)
const decodeTranscript = MediaProtocol.decodeFrame(ADAPTER, NAME, Transcript)

type Frame = string | { readonly document: string }

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

interface State {
  readonly segments: Array<TranscriptionSegment>
  readonly transcript?: Transcript
}

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

interface Capabilities {
  readonly stream: boolean
  readonly timestamps: ReadonlyArray<"segment" | "word">
  readonly diarize: boolean
  readonly languageField: "language" | "languages"
}

const TRANSCRIBE: Capabilities = { stream: true, timestamps: [], diarize: false, languageField: "language" }

const capabilities = (model: string): Capabilities => {
  if (model.startsWith("whisper")) return { ...TRANSCRIBE, stream: false, timestamps: ["segment", "word"] }
  if (model.includes("diarize")) return { ...TRANSCRIBE, timestamps: ["segment"], diarize: true }
  // `gpt-transcribe` replaces `language` with `languages[]` and rejects both together.
  if (model.startsWith("gpt-transcribe")) return { ...TRANSCRIBE, languageField: "languages" }
  return TRANSCRIBE
}

const unsupported = (operation: string, message: string) =>
  Effect.fail(ProviderShared.unsupportedOperation({ operation, provider: PROVIDER, route: ADAPTER, message }))

const validate = (request: MediaProtocol.Addressed<Request>, model: Capabilities) => {
  const id = request.model.id
  if (request.mode === "stream" && !model.stream)
    return unsupported("media.stream", `${id} does not stream; use Transcription.generate`)
  if (request.diarize === true && !model.diarize)
    return unsupported("media.diarize", `${id} does not diarize; use gpt-4o-transcribe-diarize`)
  if (request.prompt !== undefined && model.diarize)
    return unsupported("media.prompt", `${id} does not accept a prompt`)
  if (
    request.timestamps === undefined ||
    request.timestamps === "none" ||
    model.timestamps.includes(request.timestamps)
  )
    return Effect.void
  return unsupported("media.timestamps", `${id} does not return ${request.timestamps} timestamps`)
}

const RESERVED_FORM_FIELDS = new Set([
  "file",
  "model",
  "prompt",
  "language",
  "response_format",
  "timestamp_granularities",
  "stream",
])

const appendField = (form: FormData, key: string, value: unknown) => {
  if (Array.isArray(value)) return value.forEach((item) => form.append(`${key}[]`, String(item)))
  form.append(key, typeof value === "object" && value !== null ? ProviderShared.encodeJson(value) : String(value))
}

const fromRequest = Effect.fn("OpenAITranscription.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  const model = capabilities(request.model.id)
  yield* validate(request, model)
  // The API detects the audio format from the upload's filename extension.
  const extension = mediaTypeExtension(request.audio.mediaType)
  if (extension === undefined)
    return yield* ProviderShared.invalidRequest(
      `${NAME} cannot name a ${request.audio.mediaType} upload; send mp3, mp4, m4a, wav, webm, ogg, or flac audio`,
    )
  const audio = yield* MediaInput.inlineBytes(ADAPTER, request.audio)
  const responseFormat = model.diarize
    ? "diarized_json"
    : request.timestamps === undefined || request.timestamps === "none"
      ? undefined
      : "verbose_json"
  const native = Object.entries(mergeJsonRecords(request.providerOptions, request.http?.body) ?? {}).filter(
    ([key]) => !RESERVED_FORM_FIELDS.has(key),
  )
  const fields = mergeJsonRecords(
    {
      model: request.model.id,
      language: model.languageField === "language" ? request.language : undefined,
      languages: model.languageField === "languages" && request.language !== undefined ? [request.language] : undefined,
      prompt: request.prompt,
      response_format: responseFormat,
      timestamp_granularities: responseFormat === "verbose_json" ? [request.timestamps] : undefined,
      // Diarizing audio longer than 30 seconds requires a chunking strategy.
      chunking_strategy: model.diarize ? "auto" : undefined,
      stream: request.mode === "stream" ? true : undefined,
    },
    Object.fromEntries(native),
  )
  const form = new FormData()
  form.append("file", MediaInput.blob(audio, request.audio.mediaType), `audio.${extension}`)
  Object.entries(fields ?? {}).forEach(([key, value]) => appendField(form, key, value))
  return MediaProtocol.multipart(form)
})

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const segment = (value: Schema.Schema.Type<typeof Segment>): TranscriptionSegment => ({
  text: value.text.trim(),
  startSeconds: value.start,
  endSeconds: value.end,
  speaker: value.speaker,
})

const onEvent = Effect.fn("OpenAITranscription.onEvent")(function* (state: State, frame: string) {
  const event = yield* decodeEvent(frame)
  if (event.type === "transcript.text.done") return [{ ...state, transcript: event }, []] as const
  if (event.type === "transcript.text.delta")
    return [state, event.delta.length === 0 ? [] : [TranscriptionTextDeltaEvent.make({ delta: event.delta })]] as const
  const next = segment(event)
  state.segments.push(next)
  return [state, [TranscriptionSegmentEvent.make({ segment: next })]] as const
})

const step = (state: State, frame: Frame) =>
  typeof frame === "string"
    ? onEvent(state, frame)
    : decodeTranscript(frame.document).pipe(Effect.map((transcript) => [{ ...state, transcript }, []] as const))

const usage = (value: Transcript["usage"]): MediaUsage | undefined => {
  if (value === undefined) return undefined
  if (value.type === "duration") return { type: "seconds", seconds: value.seconds }
  return {
    type: "tokens",
    input: value.input_tokens,
    output: value.output_tokens,
    total: value.total_tokens,
    details: { openai: value },
  }
}

const finish = (state: State) => {
  const transcript = state.transcript
  if (transcript === undefined) return Effect.fail(MediaProtocol.incomplete(ADAPTER))
  const segments = transcript.segments?.map(segment) ?? state.segments
  return Effect.succeed([
    TranscriptionFinishEvent.make({
      text: transcript.text,
      segments: segments.length === 0 ? undefined : segments,
      words: transcript.words?.map((word) => ({ text: word.word, startSeconds: word.start, endSeconds: word.end })),
      language: (transcript.language ?? transcript.languages?.[0]?.code)?.toLowerCase(),
      durationSeconds: transcript.duration,
      usage: usage(transcript.usage),
    }),
  ])
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, TranscriptionEvent, Frame, State>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["speakers"],
  body: { from: fromRequest },
  frames: (bytes, context) =>
    context.request.mode === "stream"
      ? Framing.sse.frame(bytes)
      : Framing.document.frame(bytes).pipe(Stream.map((document) => ({ document }))),
  initial: () => ({ segments: [] }),
  step,
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  TranscriptionModel.fromRoute<OpenAITranscriptionOptions, Frame, State>(
    { id: ADAPTER, provider: PROVIDER, protocol, baseURL: DEFAULT_BASE_URL, path: PATH },
    input,
  )

export const OpenAITranscription = {
  protocol,
  model,
} as const
