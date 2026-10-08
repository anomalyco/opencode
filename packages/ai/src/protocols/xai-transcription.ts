import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import {
  TranscriptionModel,
  TranscriptionResponse,
  type TranscriptionRequestFor,
  type TranscriptionSegment,
  type TranscriptionWord,
} from "../transcription.js"
import { mediaTypeExtension } from "../utils/media-type.js"
import { ProviderShared } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "xai-transcription", name: "xAI Transcription", provider: "xai" })
export const DEFAULT_BASE_URL = "https://api.x.ai/v1"
export const PATH = "/stt"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type XAITranscriptionOptions = {
  /** Inverse text normalization ("one hundred dollars" → "$100"); requires `language`. */
  readonly format?: boolean
  readonly keyterm?: ReadonlyArray<string>
  readonly filler_words?: boolean
  /** Headerless audio only; derived from `audio.info.encoding` and `audio.info.sampleRate` when omitted. */
  readonly audio_format?: OpenString<"pcm" | "mulaw" | "alaw">
  readonly sample_rate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000
  readonly multichannel?: boolean
  readonly channels?: number
  readonly vad_threshold?: number
} & Record<string, unknown>

export type Request = TranscriptionRequestFor<XAITranscriptionOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const Word = Schema.Struct({
  text: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  confidence: Schema.optional(Schema.Number),
  speaker: Schema.optional(Schema.Number),
})

const SttResponse = Schema.Struct({
  text: Schema.String,
  language: Schema.optional(Schema.String),
  duration: Schema.optional(Schema.Number),
  words: Schema.optional(Schema.Array(Word)),
  channels: Schema.optional(
    Schema.Array(
      Schema.Struct({
        index: Schema.Number,
        text: Schema.String,
        language: Schema.optional(Schema.String),
        words: Schema.optional(Schema.Array(Word)),
      }),
    ),
  ),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** xAI returns only words, so segments are diarized speaker turns, as with AssemblyAI utterances. */
const wantsSegments = (request: Request) => request.diarize === true || request.timestamps === "segment"

const RAW_AUDIO_FORMATS: Readonly<Record<string, string>> = {
  pcm_s16le: "pcm",
  pcm_mulaw: "mulaw",
  pcm_alaw: "alaw",
}

const RESERVED_FORM_FIELDS = new Set(["file", "url", "model", "language", "diarize"])

const fromRequest = Effect.fn("XAITranscription.fromRequest")(function* (request: Request) {
  const audioFormat = RAW_AUDIO_FORMATS[request.audio.info?.encoding ?? ""]
  const form = new FormData()
  MediaInput.appendFields(
    form,
    {
      model: request.model.id,
      language: request.language,
      diarize: wantsSegments(request) ? true : undefined,
      audio_format: audioFormat,
      sample_rate: audioFormat === undefined ? undefined : request.audio.info?.sampleRate,
    },
    {
      overlay: mergeJsonRecords(request.providerOptions, request.http?.body),
      reserved: RESERVED_FORM_FIELDS,
      repeatArrays: "key",
    },
  )
  // `file` must be the last field: options after it may be ignored for streamed uploads.
  const url = ProviderShared.mediaUrl(request.audio)
  if (url !== undefined) {
    form.append("url", url)
    return MediaProtocol.multipart(form)
  }
  const audio = yield* MediaInput.inlineBytes(route.id, request.audio)
  const extension = mediaTypeExtension(request.audio.mediaType)
  form.append(
    "file",
    MediaInput.blob(audio, request.audio.mediaType),
    extension === undefined ? "audio" : `audio.${extension}`,
  )
  return MediaProtocol.multipart(form)
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStt = route.decodeJson(SttResponse)

const word = (value: typeof Word.Type): TranscriptionWord => ({
  text: value.text,
  startSeconds: value.start,
  endSeconds: value.end,
  speaker: value.speaker === undefined ? undefined : String(value.speaker),
  confidence: value.confidence,
})

const speakerSegments = (words: ReadonlyArray<TranscriptionWord>) =>
  words.reduce<Array<TranscriptionSegment>>((turns, next) => {
    const last = turns.at(-1)
    if (last === undefined || last.speaker !== next.speaker)
      return [
        ...turns,
        { text: next.text, startSeconds: next.startSeconds, endSeconds: next.endSeconds, speaker: next.speaker },
      ]
    turns[turns.length - 1] = { ...last, text: `${last.text} ${next.text}`, endSeconds: next.endSeconds }
    return turns
  }, [])

const decodeResponse = Effect.fn("XAITranscription.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.DecodeContext<Request>,
) {
  const output = yield* decodeStt(response)
  const transcript = output.value
  const words = transcript.words?.map(word)
  const duration = transcript.duration
  return new TranscriptionResponse({
    text: transcript.text,
    segments: words === undefined || !wantsSegments(context.request) ? undefined : speakerSegments(words),
    words,
    language: transcript.language?.toLowerCase(),
    durationSeconds: duration,
    usage: duration === undefined ? undefined : { type: "seconds", seconds: duration },
    providerMetadata: transcript.channels === undefined ? undefined : { xai: { channels: transcript.channels } },
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
  TranscriptionModel.fromRoute<XAITranscriptionOptions>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const XAITranscription = {
  protocol,
  model,
} as const
