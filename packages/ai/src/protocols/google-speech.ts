import { Effect, Schema } from "effect"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"
import { SpeechStream } from "./utils/speech-stream.js"

const route = MediaProtocol.identity({ id: "google-speech", name: "Google Speech", provider: "google" })
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
const DEFAULT_SAMPLE_RATE = 24000

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Style is directed in the text itself, and `speechConfig.multiSpeakerVoiceConfig` excludes `voice`. */
export type GoogleSpeechOptions = {
  readonly temperature?: number
  readonly seed?: number
  readonly speechConfig?: {
    readonly multiSpeakerVoiceConfig?: {
      readonly speakerVoiceConfigs: ReadonlyArray<{
        readonly speaker: string
        readonly voiceConfig: { readonly prebuiltVoiceConfig: { readonly voiceName: string } }
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
  if (request.format === "pcm" && request.mode === "generate" && /^gemini-3\.8-.*-tts(?:-|$)/.test(request.model.id))
    return yield* route.unsupported(
      "media.format",
      `${route.name} returns WAV by default for Gemini 3.8 TTS unary requests; omit the format to accept it`,
    )
  if (request.format !== undefined && request.format !== "pcm")
    return yield* route.unsupported(
      "media.format",
      `${route.name} only accepts raw PCM as an explicit format; omit it to accept the provider's default output`,
    )
  const voiceName = SpeechStream.voiceID(request.voice)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        contents: [{ role: "user", parts: [{ text: request.text }] }],
        generationConfig: mergeJsonRecords(
          {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: voiceName === undefined ? undefined : { prebuiltVoiceConfig: { voiceName } },
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
  const next: State = { ...GeminiGenerateContent.track(state, chunk), mimeType: state.mimeType ?? audio[0]?.mimeType }
  return [next, audio.flatMap((part) => SpeechStream.delta(next, part.data)[1])] as const
})

const finish = (state: State, context: MediaProtocol.ResponseContext<Request>) => {
  const sampleRate = SpeechStream.sampleRate(state.mimeType) ?? DEFAULT_SAMPLE_RATE
  const output =
    state.mimeType?.split(";")[0]?.toLowerCase() === "audio/wav"
      ? SpeechStream.container("wav", sampleRate)
      : SpeechStream.pcm("pcm_s16le", sampleRate, state.mimeType ?? `audio/L16;codec=pcm;rate=${sampleRate}`)
  if (context.request.format === "pcm" && output.info.format !== "pcm")
    return Effect.fail(
      route.frameError(`Google Speech returned ${output.info.format} instead of the requested raw PCM`),
    )
  return SpeechStream.finish(route, state, {
    ...output,
    usage: GeminiGenerateContent.usage(state.usage),
    providerMetadata: GeminiGenerateContent.providerMetadata(state),
    detail: state.finishReason === undefined ? undefined : `finish reason: ${state.finishReason}`,
  })
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, string, State>(route, {
  unsupported: ["instructions", "speed"],
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
