import { Effect, Schema, Stream } from "effect"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import {
  TranscriptionFinishEvent,
  TranscriptionModel,
  type TranscriptionEvent,
  type TranscriptionRequestFor,
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

/** Provider-native form fields (`keyterm`, `format`, `filler_words`, `audio_format`, `sample_rate`, …) pass through. */
export type XAITranscriptionOptions = Record<string, unknown>

export type Request = TranscriptionRequestFor<XAITranscriptionOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const Word = Schema.Struct({
  text: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  speaker: Schema.optional(Schema.Number),
})

const Channel = Schema.Struct({
  index: Schema.Number,
  text: Schema.String,
  words: Schema.optional(Schema.Array(Word)),
})

const Transcript = Schema.Struct({
  text: Schema.String,
  language: Schema.optional(Schema.String),
  duration: Schema.optional(Schema.Number),
  words: Schema.optional(Schema.Array(Word)),
  channels: Schema.optional(Schema.Array(Channel)),
})
type Transcript = Schema.Schema.Type<typeof Transcript>

const decodeTranscript = route.decodeFrame(Transcript)

type Frame = { readonly document: string }

// ---------------------------------------------------------------------------
// 3. Parser state
// ---------------------------------------------------------------------------

interface State {
  readonly transcript?: Transcript
}

// ---------------------------------------------------------------------------
// 4. Request form construction
// ---------------------------------------------------------------------------

const RESERVED_FORM_FIELDS = new Set(["file", "model", "language", "diarize", "url"])

const fromRequest = Effect.fn("XAITranscription.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  if (request.timestamps !== undefined && request.timestamps !== "none" && request.timestamps !== "word")
    return yield* route.unsupported("media.timestamps", `${route.name} returns word timestamps only`)
  const form = new FormData()
  MediaInput.appendFields(
    form,
    {
      model: request.model.id,
      language: request.language,
      diarize: request.diarize === true ? true : undefined,
    },
    {
      overlay: mergeJsonRecords(request.providerOptions, request.http?.body),
      reserved: RESERVED_FORM_FIELDS,
      // `keyterm` accepts a repeated plain field.
      repeatArrays: "key",
    },
  )
  // `file` must be the last field: xAI ignores option fields sent after it.
  if (request.audio.source.type === "url") form.append("url", request.audio.source.url)
  else {
    const extension = mediaTypeExtension(request.audio.mediaType)
    if (extension === undefined)
      return yield* ProviderShared.invalidRequest(
        `${route.name} cannot name a ${request.audio.mediaType} upload; send mp3, mp4, m4a, wav, ogg, opus, flac, or pass providerOptions.audio_format for raw audio`,
      )
    const audio = yield* MediaInput.inlineBytes(route.id, request.audio)
    form.append("file", MediaInput.blob(audio, request.audio.mediaType), `audio.${extension}`)
  }
  return MediaProtocol.multipart(form)
})

// ---------------------------------------------------------------------------
// 5. Response parsing
// ---------------------------------------------------------------------------

const step = (state: State, frame: Frame) =>
  decodeTranscript(frame.document).pipe(Effect.map((transcript) => [{ ...state, transcript }, []] as const))

const finish = (state: State) => {
  const transcript = state.transcript
  if (transcript === undefined) return Effect.fail(route.incomplete())
  // Multichannel responses carry the words per channel; the top-level text stays the transcript.
  const words = transcript.words ?? transcript.channels?.flatMap((channel) => channel.words ?? [])
  return Effect.succeed([
    TranscriptionFinishEvent.make({
      text: transcript.text,
      words: words?.map((word) => ({
        text: word.text,
        startSeconds: word.start,
        endSeconds: word.end,
        speaker: word.speaker === undefined ? undefined : String(word.speaker),
      })),
      language: transcript.language?.toLowerCase(),
      durationSeconds: transcript.duration,
      usage: transcript.duration === undefined ? undefined : { type: "seconds" as const, seconds: transcript.duration },
    }),
  ])
}

// ---------------------------------------------------------------------------
// 6. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, TranscriptionEvent, Frame, State>(route, {
  unsupported: ["speakers", "prompt"],
  body: { from: fromRequest },
  frames: (bytes) => Framing.document.frame(bytes).pipe(Stream.map((document) => ({ document }))),
  initial: () => ({}),
  step,
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  TranscriptionModel.fromRoute<XAITranscriptionOptions, Frame, State>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: PATH },
    input,
  )

export const XAITranscription = {
  protocol,
  model,
} as const
