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
  if (request.format !== undefined && request.format !== "pcm")
    return yield* route.unsupported(
      "media.format",
      `${route.name} only returns raw PCM; request format "pcm" or omit it, then wrap the samples yourself`,
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

const finish = (state: State) => {
  const sampleRate = SpeechStream.sampleRate(state.mimeType) ?? DEFAULT_SAMPLE_RATE
  return SpeechStream.finish(route, state, {
    ...SpeechStream.pcm("pcm_s16le", sampleRate, state.mimeType ?? `audio/L16;codec=pcm;rate=${sampleRate}`),
    usage: GeminiGenerateContent.usage(state.usage),
    providerMetadata: GeminiGenerateContent.providerMetadata(state),
    detail: state.finishReason === undefined ? undefined : `finish reason: ${state.finishReason}`,
  })
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, string, State>(route, {
  unsupported: ["instructions", "speed", "timestamps"],
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
