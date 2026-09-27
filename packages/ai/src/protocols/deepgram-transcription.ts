import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { TranscriptionModel, TranscriptionResponse, type TranscriptionRequestFor } from "../transcription.js"
import { ProviderShared } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "deepgram-transcription", name: "Deepgram", provider: "deepgram" })
export const DEFAULT_BASE_URL = "https://api.deepgram.com"
export const PATH = "/v1/listen"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type DeepgramTranscriptionOptions = {
  readonly smart_format?: boolean
  readonly punctuate?: boolean
  readonly paragraphs?: boolean
  readonly utterances?: boolean
  readonly detect_language?: boolean | ReadonlyArray<string>
  readonly keyterm?: ReadonlyArray<string>
  readonly diarize_model?: OpenString<"latest" | "v1" | "v2">
  readonly filler_words?: boolean
  readonly numerals?: boolean
  readonly mip_opt_out?: boolean
  readonly tag?: string | ReadonlyArray<string>
} & Record<string, unknown>

export type Request = TranscriptionRequestFor<DeepgramTranscriptionOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const Word = Schema.Struct({
  word: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  confidence: Schema.optional(Schema.Number),
  speaker: Schema.optional(Schema.Number),
  punctuated_word: Schema.optional(Schema.String),
})

const ListenResponse = Schema.Struct({
  metadata: Schema.optional(
    Schema.Struct({ request_id: Schema.optional(Schema.String), duration: Schema.optional(Schema.Number) }),
  ),
  results: Schema.Struct({
    channels: Schema.Array(
      Schema.Struct({
        alternatives: Schema.optional(
          Schema.Array(Schema.Struct({ transcript: Schema.String, words: Schema.optional(Schema.Array(Word)) })),
        ),
        detected_language: Schema.optional(Schema.String),
      }),
    ),
    utterances: Schema.optional(
      Schema.Array(
        Schema.Struct({
          start: Schema.Number,
          end: Schema.Number,
          transcript: Schema.String,
          speaker: Schema.optional(Schema.Number),
          words: Schema.optional(Schema.Array(Word)),
        }),
      ),
    ),
  }),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const query = (request: Request) =>
  MediaInput.query(
    route.id,
    mergeJsonRecords(
      {
        model: request.model.id,
        smart_format: true,
        language: request.language,
        // Deepgram assumes English unless asked to detect, unlike the other routes' auto-detection.
        detect_language: request.language === undefined ? true : undefined,
        // `diarize=true` is deprecated in favor of choosing a diarization model.
        diarize_model: request.diarize === true ? "latest" : undefined,
        utterances: request.diarize === true || request.timestamps === "segment" ? true : undefined,
      },
      request.providerOptions,
    ) ?? {},
  )

const fromRequest = Effect.fn("DeepgramTranscription.fromRequest")(function* (request: Request) {
  const url = ProviderShared.mediaUrl(request.audio)
  if (url !== undefined)
    return MediaProtocol.json(mergeJsonRecords({ url }, request.http?.body) ?? {}, yield* query(request))
  if (request.http?.body !== undefined)
    return yield* ProviderShared.invalidRequest(
      `${route.name} sends inline audio as the raw body, so http.body cannot apply`,
    )
  const audio = yield* MediaInput.inlineBytes(route.id, request.audio)
  return MediaProtocol.binary(audio, request.audio.mediaType, yield* query(request))
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeListen = route.decodeJson(ListenResponse)

const speaker = (value: number | undefined) => (value === undefined ? undefined : String(value))

const wordText = (word: typeof Word.Type) => word.punctuated_word ?? word.word

// Utterances split on pauses, not speakers: the v2 diarizer labels a whole utterance with one speaker even when its
// words change speaker, so segments split each utterance at speaker changes.
const speakerTurns = (words: ReadonlyArray<typeof Word.Type>) =>
  words.reduce<Array<Array<typeof Word.Type>>>((turns, word) => {
    const last = turns.at(-1)
    if (last === undefined || last[0].speaker !== word.speaker) return [...turns, [word]]
    last.push(word)
    return turns
  }, [])

const decodeResponse = Effect.fn("DeepgramTranscription.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeListen(response)
  const channel = output.value.results.channels[0]
  const alternative = channel?.alternatives?.[0]
  if (alternative === undefined) return yield* output.invalid(`${route.name} returned no transcript`)
  const duration = output.value.metadata?.duration
  const requestID = output.value.metadata?.request_id
  return new TranscriptionResponse({
    text: alternative.transcript,
    segments: output.value.results.utterances?.flatMap((utterance) =>
      utterance.words === undefined || utterance.words.length === 0
        ? [
            {
              text: utterance.transcript,
              startSeconds: utterance.start,
              endSeconds: utterance.end,
              speaker: speaker(utterance.speaker),
            },
          ]
        : speakerTurns(utterance.words).map((turn) => ({
            text: turn.map(wordText).join(" "),
            startSeconds: turn[0].start,
            endSeconds: turn[turn.length - 1].end,
            speaker: speaker(turn[0].speaker),
          })),
    ),
    words: alternative.words?.map((word) => ({
      text: wordText(word),
      startSeconds: word.start,
      endSeconds: word.end,
      speaker: speaker(word.speaker),
      confidence: word.confidence,
    })),
    language: channel?.detected_language?.toLowerCase(),
    durationSeconds: duration,
    usage: duration === undefined ? undefined : { type: "seconds", seconds: duration },
    providerMetadata: requestID === undefined ? undefined : { deepgram: { requestId: requestID } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, TranscriptionResponse>(route, {
  unsupported: ["prompt", "speakers"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  TranscriptionModel.fromRoute<DeepgramTranscriptionOptions>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const DeepgramTranscription = {
  protocol,
  model,
} as const
