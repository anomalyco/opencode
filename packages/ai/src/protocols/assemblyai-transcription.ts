import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { TranscriptionModel, TranscriptionResponse, type TranscriptionRequestFor } from "../transcription.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "assemblyai-transcription", name: "AssemblyAI", provider: "assemblyai" })
export const DEFAULT_BASE_URL = "https://api.assemblyai.com"
export const PATH = "/v2/transcript"
export const UPLOAD_PATH = "/v2/upload"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type AssemblyAITranscriptionOptions = {
  readonly keyterms_prompt?: ReadonlyArray<string>
  readonly punctuate?: boolean
  readonly format_text?: boolean
  readonly disfluencies?: boolean
  readonly filter_profanity?: boolean
  readonly temperature?: number
  readonly speaker_options?: { readonly min_speakers_expected?: number; readonly max_speakers_expected?: number }
  readonly language_detection_options?: {
    readonly expected_languages?: ReadonlyArray<string>
    readonly fallback_language?: string
    readonly code_switching?: boolean
  }
  readonly speech_models?: ReadonlyArray<OpenString<"universal-3-5-pro" | "universal-2">>
} & Record<string, unknown>

export type Request = TranscriptionRequestFor<AssemblyAITranscriptionOptions>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

export const Token = Schema.Struct({ transcriptID: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

const Upload = Schema.Struct({ upload_url: Schema.String })

/** Word and utterance times are milliseconds. */
const Transcript = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  text: optionalNull(Schema.String),
  words: optionalNull(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        start: Schema.Number,
        end: Schema.Number,
        confidence: optionalNull(Schema.Number),
        speaker: optionalNull(Schema.String),
      }),
    ),
  ),
  utterances: optionalNull(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        start: Schema.Number,
        end: Schema.Number,
        speaker: optionalNull(Schema.String),
      }),
    ),
  ),
  language_code: optionalNull(Schema.String),
  audio_duration: optionalNull(Schema.Number),
  speech_model_used: optionalNull(Schema.String),
  error: optionalNull(Schema.String),
})

const STATUS = {
  queued: "queued",
  processing: "running",
  completed: "completed",
  error: "failed",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const decodeUpload = route.decodeJson(Upload)

/** `/v2/transcript` only takes a URL, so inline audio is uploaded to `/v2/upload` first. */
const prepare = Effect.fn("AssemblyAITranscription.prepare")(function* (request: Request, send: MediaProtocol.Send) {
  if (request.audio.source.type !== "bytes" && request.audio.source.type !== "base64") return request
  const audio = yield* MediaInput.inlineBytes(route.id, request.audio)
  const uploaded = yield* send(UPLOAD_PATH, MediaProtocol.binary(audio, "application/octet-stream")).pipe(
    Effect.flatMap(decodeUpload),
  )
  return { ...request, audio: Media.url(uploaded.value.upload_url, { mediaType: request.audio.mediaType }) }
})

const fromRequest = Effect.fn("AssemblyAITranscription.fromRequest")(function* (request: Request) {
  const audio = yield* ProviderShared.mediaReference(request.audio, route.provider, route.name)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        audio_url: audio.value,
        speech_models: [request.model.id],
        language_code: request.language,
        language_detection: request.language === undefined ? true : undefined,
        prompt: request.prompt,
        // Turn-level `utterances`, the only segments AssemblyAI returns, and `speakers_expected` require speaker labels.
        speaker_labels:
          request.diarize === true || request.timestamps === "segment" || request.speakers !== undefined
            ? true
            : undefined,
        speakers_expected: request.speakers,
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeTranscript = route.decodeJson(Transcript)

const decodeStart = Effect.fn("AssemblyAITranscription.decodeStart")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeTranscript(response)
  const status = yield* MediaProtocol.status(STATUS, output.value.status, output)
  return { token: { transcriptID: output.value.id }, snapshot: { id: output.value.id, status } }
})

const decodeStatus = Effect.fn("AssemblyAITranscription.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeTranscript(response)
  const status = yield* MediaProtocol.status(STATUS, output.value.status, output)
  return { id: context.token.transcriptID, status }
})

const seconds = (milliseconds: number) => milliseconds / 1000

const decodeResult = Effect.fn("AssemblyAITranscription.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeTranscript(response)
  const transcript = output.value
  const status = yield* MediaProtocol.status(STATUS, transcript.status, output)
  const error = transcript.error ?? undefined
  if (status === "failed")
    return yield* output.ended("failed", `${route.name} transcription failed${error === undefined ? "" : `: ${error}`}`)
  if (status !== "completed") return yield* output.pending(context.token.transcriptID)
  const duration = transcript.audio_duration ?? undefined
  return new TranscriptionResponse({
    text: transcript.text ?? "",
    segments: transcript.utterances?.map((utterance) => ({
      text: utterance.text,
      startSeconds: seconds(utterance.start),
      endSeconds: seconds(utterance.end),
      speaker: utterance.speaker ?? undefined,
    })),
    words: transcript.words?.map((word) => ({
      text: word.text,
      startSeconds: seconds(word.start),
      endSeconds: seconds(word.end),
      speaker: word.speaker ?? undefined,
      confidence: word.confidence ?? undefined,
    })),
    language: transcript.language_code?.toLowerCase(),
    durationSeconds: duration,
    usage: duration === undefined ? undefined : { type: "seconds", seconds: duration },
    providerMetadata: {
      assemblyai: { transcriptId: transcript.id, speechModel: transcript.speech_model_used ?? undefined },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

const transcriptPath = (token: Token) => `${PATH}/${token.transcriptID}`

export const protocol = MediaProtocol.queued<Request, TranscriptionResponse, Token>(route, {
  token: Token,
  start: { prepare, body: { from: fromRequest }, decode: decodeStart },
  status: { path: transcriptPath, decode: decodeStatus },
  result: { path: transcriptPath, decode: decodeResult },
})

export const model = (input: MediaRoute.ModelInput) =>
  TranscriptionModel.fromRoute<AssemblyAITranscriptionOptions, Token>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: PATH },
    input,
  )

export const AssemblyAITranscription = {
  protocol,
  model,
} as const
