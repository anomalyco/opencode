import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { TranscriptionModel, TranscriptionResponse, type TranscriptionRequestFor } from "../transcription.js"
import { mediaTypeExtension } from "../utils/media-type.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"
import { SpeakerTurns } from "./utils/speaker-turns.js"

const route = MediaProtocol.identity({
  id: "elevenlabs-transcription",
  name: "ElevenLabs Transcription",
  provider: "elevenlabs",
})
export const DEFAULT_BASE_URL = "https://api.elevenlabs.io"
export const PATH = "/v1/speech-to-text"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type ElevenLabsTranscriptionOptions = {
  /** Experimental batch edit; adds a 30% surcharge. The original timed transcript is unchanged. */
  readonly transcript_edit?: string
  readonly tag_audio_events?: boolean
  readonly timestamps_granularity?: OpenString<"none" | "word" | "character">
  readonly diarization_threshold?: number
  readonly file_format?: OpenString<"pcm_s16le_16" | "other">
  readonly temperature?: number
  readonly seed?: number
  readonly keyterms?: ReadonlyArray<string>
  readonly no_verbatim?: boolean
  readonly detect_speaker_roles?: boolean
  readonly use_speaker_library?: boolean
  readonly entity_detection?: string | ReadonlyArray<string>
  readonly entity_redaction?: string | ReadonlyArray<string>
  readonly entity_redaction_mode?: OpenString<"redacted" | "entity_type" | "enumerated_entity_type">
} & Record<string, unknown>

export type Request = TranscriptionRequestFor<ElevenLabsTranscriptionOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

/** `type` is `word`, `spacing` (the whitespace between words), or `audio_event` (`(laughter)`). */
const Token = Schema.Struct({
  text: Schema.String,
  type: Schema.String,
  start: optionalNull(Schema.Number),
  end: optionalNull(Schema.Number),
  speaker_id: optionalNull(Schema.String),
  logprob: optionalNull(Schema.Number),
})
type Token = Schema.Schema.Type<typeof Token>

const Transcript = Schema.Struct({
  language_code: optionalNull(Schema.String),
  text: Schema.String,
  words: optionalNull(Schema.Array(Token)),
  transcription_id: optionalNull(Schema.String),
  audio_duration_secs: optionalNull(Schema.Number),
  edited_transcript: optionalNull(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("transcript"), text: Schema.String }),
      Schema.Struct({
        kind: Schema.Literal("error"),
        error_type: Schema.Literal("edit_failed"),
        message: Schema.String,
      }),
    ]),
  ),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** Speaker turns are the only segments ElevenLabs can produce, and `num_speakers` only applies to diarization. */
const diarizes = (request: Request) =>
  request.diarize === true || request.timestamps === "segment" || request.speakers !== undefined

const RESERVED_FORM_FIELDS = new Set([
  "file",
  "cloud_storage_url",
  "source_url",
  "model_id",
  "language_code",
  "diarize",
  "num_speakers",
])

const validate = (request: Request, overlay: Record<string, unknown>) => {
  // Webhook requests return 202 with no transcript; the result arrives at a configured webhook instead.
  if (overlay.webhook === true)
    return Effect.fail(route.unsupported("transcription.webhook", `${route.name} does not deliver to webhooks`))
  if (overlay.transcript_edit != null) {
    if (typeof overlay.transcript_edit !== "string" || overlay.transcript_edit.length > 2000)
      return Effect.fail(
        route.unsupported(
          "transcription.transcript_edit",
          `${route.name} transcript_edit must be a string of at most 2000 characters`,
        ),
      )
    if (overlay.entity_detection != null || overlay.entity_redaction != null || overlay.use_multi_channel === true)
      return Effect.fail(
        route.unsupported(
          "transcription.transcript_edit",
          `${route.name} transcript_edit cannot be combined with entity_detection, entity_redaction, or use_multi_channel`,
        ),
      )
  }
  // Separate multichannel output replaces the transcript with one transcript per channel.
  if (overlay.use_multi_channel === true && overlay.multichannel_output_style !== "combined")
    return Effect.fail(
      route.unsupported(
        "transcription.multichannel",
        `${route.name} returns a single transcript; set multichannel_output_style: "combined" to merge channels`,
      ),
    )
  if (overlay.timestamps_granularity === "none" && (request.timestamps === "word" || diarizes(request)))
    return Effect.fail(
      route.unsupported(
        "media.timestamps",
        `${route.name} cannot return word timestamps or speaker turns with timestamps_granularity: "none"`,
      ),
    )
  return Effect.void
}

const fromRequest = Effect.fn("ElevenLabsTranscription.fromRequest")(function* (request: Request) {
  const overlay = mergeJsonRecords(request.providerOptions, request.http?.body) ?? {}
  yield* validate(request, overlay)
  const form = new FormData()
  const url = ProviderShared.mediaUrl(request.audio)
  if (url === undefined) {
    const extension = mediaTypeExtension(request.audio.mediaType)
    const audio = yield* MediaInput.inlineBytes(route.id, request.audio)
    form.append(
      "file",
      MediaInput.blob(audio, request.audio.mediaType),
      extension === undefined ? "audio" : `audio.${extension}`,
    )
  }
  MediaInput.appendFields(
    form,
    {
      model_id: request.model.id,
      // `cloud_storage_url` is deprecated in favor of `source_url`, which accepts any hosted audio or video URL.
      source_url: url,
      language_code: request.language,
      diarize: diarizes(request) ? true : undefined,
      num_speakers: request.speakers,
    },
    { overlay, reserved: RESERVED_FORM_FIELDS, repeatArrays: "key" },
  )
  return MediaProtocol.multipart(form)
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeTranscript = route.decodeJson(Transcript)

type TimedWord = Token & { readonly start: number; readonly end: number }

const isTimedWord = (token: Token): token is TimedWord =>
  token.type === "word" && typeof token.start === "number" && typeof token.end === "number"

/** Turn text keeps the provider's own spacing tokens, so languages written without spaces are not re-spaced. */
const speakerTurns = (tokens: ReadonlyArray<Token>) =>
  SpeakerTurns.group(
    tokens.filter((token) => token.type === "word" || token.type === "spacing"),
    (token) => token.speaker_id,
  ).flatMap((turn) => {
    const words = turn.filter(isTimedWord)
    if (words.length === 0) return []
    return [
      {
        text: turn
          .map((token) => token.text)
          .join("")
          .trim(),
        startSeconds: words[0].start,
        endSeconds: words[words.length - 1].end,
        speaker: turn[0].speaker_id ?? undefined,
      },
    ]
  })

const decodeResponse = Effect.fn("ElevenLabsTranscription.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.DecodeContext<Request>,
) {
  const output = yield* decodeTranscript(response)
  const transcript = output.value
  const tokens = transcript.words ?? []
  const duration = transcript.audio_duration_secs ?? undefined
  const transcriptionID = transcript.transcription_id ?? undefined
  const edited = transcript.edited_transcript
  return new TranscriptionResponse({
    text: transcript.text,
    segments: diarizes(context.request) ? speakerTurns(tokens) : undefined,
    words: tokens.filter(isTimedWord).map((word) => ({
      text: word.text,
      startSeconds: word.start,
      endSeconds: word.end,
      speaker: word.speaker_id ?? undefined,
      confidence: typeof word.logprob === "number" ? Math.exp(word.logprob) : undefined,
    })),
    language: transcript.language_code?.toLowerCase(),
    durationSeconds: duration,
    usage: duration === undefined ? undefined : { type: "seconds", seconds: duration },
    notices:
      edited?.kind === "error"
        ? [
            {
              type: "other",
              message: `ElevenLabs transcript edit failed: ${edited.message}`,
              providerMetadata: { elevenlabs: { errorType: edited.error_type } },
            },
          ]
        : undefined,
    providerMetadata:
      transcriptionID === undefined && edited == null
        ? undefined
        : {
            elevenlabs: {
              ...(transcriptionID === undefined ? {} : { transcriptionId: transcriptionID }),
              ...(edited == null
                ? {}
                : {
                    editedTranscript:
                      edited.kind === "transcript"
                        ? { kind: edited.kind, text: edited.text }
                        : { kind: edited.kind, errorType: edited.error_type, message: edited.message },
                  }),
            },
          },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, TranscriptionResponse>(route, {
  unsupported: ["prompt"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  TranscriptionModel.fromRoute<ElevenLabsTranscriptionOptions>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: PATH },
    input,
  )

export const ElevenLabsTranscription = {
  protocol,
  model,
} as const
