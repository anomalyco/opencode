import { Effect, Option, Schema } from "effect"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"
import { SpeechStream } from "./utils/speech-stream.js"

const route = MediaProtocol.identity({ id: "google-speech", name: "Google Speech", provider: "google" })
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
const DEFAULT_SAMPLE_RATE = 24000

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** `speechConfig.multiSpeakerVoiceConfig` excludes `voice`. `responseFormat` is Gemini 3.8 TTS only. */
export type GoogleSpeechOptions = {
  readonly temperature?: number
  readonly seed?: number
  readonly responseFormat?: {
    readonly audio?: {
      readonly mimeType?: OpenString<"AUDIO_WAV" | "AUDIO_L16" | "AUDIO_MULAW" | "AUDIO_ALAW">
      readonly sampleRate?: number
    }
  }
  readonly speechConfig?: {
    readonly multiSpeakerVoiceConfig?: {
      readonly speakerVoiceConfigs: ReadonlyArray<{
        readonly speaker: string
        readonly voiceConfig:
          | { readonly prebuiltVoiceConfig: { readonly voiceName: string } }
          | { readonly voice: string }
      }>
    }
  }
} & Record<string, unknown>

export type Request = SpeechRequestFor<GoogleSpeechOptions>

// ---------------------------------------------------------------------------
// 3. Streaming event schema
// ---------------------------------------------------------------------------

const GenerateContentChunk = GeminiGenerateContent.chunk(
  Schema.Struct({
    text: Schema.optional(Schema.String),
    inlineData: Schema.optional(Schema.Struct({ mimeType: Schema.String, data: Schema.Uint8ArrayFromBase64 })),
  }),
)

const decodeChunk = route.decodeFrame(GenerateContentChunk)

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

interface State extends SpeechStream.Audio, GeminiGenerateContent.Metadata {
  readonly mimeType?: string
}

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const fromRequest = Effect.fn("GoogleSpeech.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  // Not in `unsupported`: that list would also reject `timestamps: false`, which asks for nothing.
  if (request.timestamps === true)
    return yield* route.unsupported("media.timestamps", `${route.name} does not return timestamps`)
  const structured = isGemini38TTS(request.model.id)
  if (request.instructions !== undefined && !structured)
    return yield* route.unsupported(
      "media.instructions",
      `${route.name} takes style directions in the text before Gemini 3.8 TTS`,
    )
  const mimeType = yield* responseMimeType(request, structured)
  const voice = SpeechStream.voiceID(request.voice)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: request.text,
                speechMetadata: request.instructions === undefined ? undefined : { style: request.instructions },
              },
            ],
          },
        ],
        generationConfig: mergeJsonRecords(
          {
            responseModalities: ["AUDIO"],
            responseFormat: mimeType === undefined ? undefined : { audio: { mimeType } },
            speechConfig: {
              voiceConfig:
                voice === undefined
                  ? undefined
                  : structured
                    ? { voice }
                    : { prebuiltVoiceConfig: { voiceName: voice } },
              languageCode: request.language,
            },
          },
          request.providerOptions,
        ),
      },
      request.http?.body,
    ) ?? {},
  )
})

/**
 * Gemini 3.8 TTS reads `text` as a verbatim transcript, takes style in `speechMetadata`, accepts stored `voice_…` ids
 * in `voiceConfig.voice`, and selects its output encoding through `responseFormat`. Earlier TTS models support none.
 */
const isGemini38TTS = (modelID: string) => /^gemini-3\.8-.*-tts(?:-|$)/.test(modelID)

// mu-law and A-law have no common `format`; request them with `providerOptions.responseFormat.audio.mimeType`.
const RESPONSE_MIME_TYPES: Readonly<Record<string, string>> = { pcm: "AUDIO_L16", wav: "AUDIO_WAV" }

const responseMimeType = Effect.fn("GoogleSpeech.responseMimeType")(function* (
  request: MediaProtocol.Addressed<Request>,
  structured: boolean,
) {
  if (request.format === undefined) return undefined
  // Earlier TTS models always return raw PCM and reject `responseFormat`.
  if (!structured && request.format === "pcm") return undefined
  if (!structured)
    return yield* route.unsupported(
      "media.format",
      `${route.name} only accepts raw PCM as an explicit format before Gemini 3.8 TTS; omit it to accept the provider's default output`,
    )
  const mimeType = RESPONSE_MIME_TYPES[request.format]
  if (mimeType === undefined)
    return yield* route.unsupported(
      "media.format",
      `${route.name} accepts pcm or wav; set providerOptions.responseFormat.audio for mu-law or A-law`,
    )
  if (request.format === "wav" && request.mode === "stream")
    return yield* route.unsupported("media.format", `${route.name} streams headerless PCM; use generate for WAV`)
  return mimeType
})

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const step = Effect.fn("GoogleSpeech.step")(function* (state: State, frame: string) {
  const chunk = yield* decodeChunk(frame)
  const blocked = GeminiGenerateContent.blocked(route.name, chunk, frame)
  if (blocked !== undefined) return yield* blocked
  const audio = (chunk.candidates?.[0]?.content?.parts ?? []).flatMap((part) =>
    part.inlineData === undefined ? [] : [part.inlineData],
  )
  const mimeType = state.mimeType ?? audio[0]?.mimeType
  const mixed = audio.find((part) => audioType(part.mimeType) !== audioType(mimeType))
  if (mixed !== undefined)
    return yield* route.frameError(`${route.name} returned mixed audio types (${mimeType}, ${mixed.mimeType})`, frame)
  const next: State = { ...GeminiGenerateContent.track(state, chunk), mimeType }
  const events = audio.flatMap((part) => SpeechStream.delta(next, part.data)[1])
  const withheld = next.chunks.length === 0 ? GeminiGenerateContent.withheld(route.name, chunk, frame) : undefined
  if (withheld !== undefined) return yield* withheld
  return [next, events] as const
})

const finish = (state: State, context: MediaProtocol.ResponseContext<Request>) => {
  if (state.finishReason === undefined) return Effect.fail(route.incomplete())
  const output = audioOutput(state.mimeType, sentSampleRate(context.body))
  if (context.request.format !== undefined && output.info?.format !== context.request.format)
    return Effect.fail(
      route.frameError(
        `${route.name} returned ${output.info?.format ?? state.mimeType} instead of the requested ${context.request.format}`,
      ),
    )
  return SpeechStream.finish(route, state, {
    ...output,
    usage: GeminiGenerateContent.usage(state.usage),
    notices: GeminiGenerateContent.notices(route.name, state),
    providerMetadata: GeminiGenerateContent.providerMetadata(state),
    detail: `finish reason: ${state.finishReason}`,
  })
}

const audioType = (mimeType: string | undefined) => mimeType?.split(";")[0]?.trim().toLowerCase()

const COMPANDED_ENCODINGS: Readonly<Record<string, SpeechStream.PcmEncoding>> = {
  "audio/mulaw": "pcm_mulaw",
  "audio/alaw": "pcm_alaw",
}

/** Describe the audio from the provider's declared type; an omitted type is Gemini's default L16. */
const audioOutput = (mimeType: string | undefined, requestedSampleRate: number | undefined) => {
  const sampleRate = SpeechStream.sampleRate(mimeType) ?? requestedSampleRate ?? DEFAULT_SAMPLE_RATE
  const type = audioType(mimeType)
  if (type === "audio/wav") return SpeechStream.container("wav", sampleRate)
  if (type === undefined || type === "audio/l16")
    return SpeechStream.pcm("pcm_s16le", sampleRate, mimeType ?? `audio/L16;codec=pcm;rate=${sampleRate}`)
  const encoding = COMPANDED_ENCODINGS[type]
  if (encoding !== undefined) return SpeechStream.pcm(encoding, sampleRate, mimeType)
  return { mediaType: mimeType, info: undefined }
}

const SentSampleRate = Schema.Struct({
  generationConfig: Schema.Struct({
    responseFormat: Schema.Struct({ audio: Schema.Struct({ sampleRate: Schema.Number }) }),
  }),
})

// The sent body reflects `providerOptions` and `http.body` overrides of the sample rate.
const sentSampleRate = (body: MediaProtocol.Body) =>
  body.type === "json"
    ? Option.getOrUndefined(Schema.decodeUnknownOption(SentSampleRate)(body.value))?.generationConfig.responseFormat
        .audio.sampleRate
    : undefined

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, string, State>(route, {
  unsupported: ["speed"],
  body: { from: fromRequest },
  frames: (bytes, context) => GeminiGenerateContent.frames(bytes, context.request.mode),
  initial: () => ({ chunks: [] }),
  step,
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<GoogleSpeechOptions, string, State>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      // Only `gemini-3.1-flash-tts-preview` and later stream; earlier TTS models reject `streamGenerateContent`.
      path: ({ request }) => GeminiGenerateContent.path(request.model.id, request.mode),
    },
    input,
  )

export const GoogleSpeech = {
  protocol,
  model,
} as const
