import { Effect, Schema } from "effect"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { AIError, ContentPolicyError, ProviderID, mergeJsonRecords } from "../schema/index.js"
import { SpeechModel, type SpeechEvent, type SpeechRequestFor } from "../speech.js"
import { ProviderShared } from "./shared.js"
import { SpeechStream } from "./utils/speech-stream.js"

const ADAPTER = "google-speech"
const NAME = "Google Speech"
const PROVIDER = ProviderID.make("google")
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

const GenerateContentChunk = Schema.Struct({
  candidates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        content: Schema.optional(
          Schema.Struct({
            parts: Schema.optional(
              Schema.Array(
                Schema.Struct({
                  text: Schema.optional(Schema.String),
                  inlineData: Schema.optional(
                    Schema.Struct({ mimeType: Schema.String, data: Schema.Uint8ArrayFromBase64 }),
                  ),
                }),
              ),
            ),
          }),
        ),
        finishReason: Schema.optional(Schema.String),
      }),
    ),
  ),
  promptFeedback: Schema.optional(
    Schema.Struct({ blockReason: Schema.optional(Schema.String), blockReasonMessage: Schema.optional(Schema.String) }),
  ),
  usageMetadata: Schema.optional(
    Schema.Struct({
      promptTokenCount: Schema.optional(Schema.Number),
      candidatesTokenCount: Schema.optional(Schema.Number),
      totalTokenCount: Schema.optional(Schema.Number),
    }),
  ),
  modelVersion: Schema.optional(Schema.String),
  responseId: Schema.optional(Schema.String),
})
type GenerateContentChunk = Schema.Schema.Type<typeof GenerateContentChunk>

const decodeChunk = MediaProtocol.decodeFrame(ADAPTER, NAME, GenerateContentChunk)

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

interface State extends SpeechStream.Audio {
  readonly mimeType?: string
  readonly usage?: GenerateContentChunk["usageMetadata"]
  readonly finishReason?: string
  readonly modelVersion?: string
  readonly responseId?: string
}

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const fromRequest = Effect.fn("GoogleSpeech.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  if (request.format !== undefined && request.format !== "pcm")
    return yield* SpeechStream.unsupportedFormat(
      PROVIDER,
      ADAPTER,
      `${NAME} only returns raw PCM; request format "pcm" or omit it, then wrap the samples yourself`,
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

// Only `gemini-3.1-flash-tts-preview` and later stream; earlier TTS models reject `streamGenerateContent`.
const path = (request: MediaProtocol.Addressed<Request>) =>
  request.mode === "stream"
    ? `/models/${request.model.id}:streamGenerateContent?alt=sse`
    : `/models/${request.model.id}:generateContent`

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const step = Effect.fn("GoogleSpeech.step")(function* (state: State, frame: string) {
  const chunk = yield* decodeChunk(frame)
  const blockReason = chunk.promptFeedback?.blockReason
  if (blockReason !== undefined)
    return yield* new AIError({
      reason: new ContentPolicyError({
        message: `${NAME} blocked the prompt (${blockReason})${
          chunk.promptFeedback?.blockReasonMessage === undefined ? "" : `: ${chunk.promptFeedback.blockReasonMessage}`
        }`,
        body: frame,
      }),
    })
  const candidate = chunk.candidates?.[0]
  const audio = (candidate?.content?.parts ?? []).flatMap((part) =>
    part.inlineData === undefined ? [] : [part.inlineData],
  )
  const next: State = {
    ...state,
    mimeType: state.mimeType ?? audio[0]?.mimeType,
    usage: chunk.usageMetadata ?? state.usage,
    finishReason: candidate?.finishReason ?? state.finishReason,
    modelVersion: chunk.modelVersion ?? state.modelVersion,
    responseId: chunk.responseId ?? state.responseId,
  }
  return [next, audio.flatMap((part) => SpeechStream.delta(next, part.data)[1])] as const
})

const finish = (state: State) => {
  const usage = state.usage
  const sampleRate = SpeechStream.sampleRate(state.mimeType) ?? DEFAULT_SAMPLE_RATE
  return SpeechStream.finish(ADAPTER, state, {
    ...SpeechStream.pcm("pcm_s16le", sampleRate, state.mimeType ?? `audio/L16;codec=pcm;rate=${sampleRate}`),
    usage:
      usage === undefined
        ? undefined
        : {
            type: "tokens",
            input: usage.promptTokenCount,
            output: usage.candidatesTokenCount,
            total: ProviderShared.totalTokens(
              usage.promptTokenCount,
              usage.candidatesTokenCount,
              usage.totalTokenCount,
            ),
            details: { google: usage },
          },
    providerMetadata: {
      google: { finishReason: state.finishReason, modelVersion: state.modelVersion, responseId: state.responseId },
    },
    detail: state.finishReason === undefined ? undefined : `finish reason: ${state.finishReason}`,
  })
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, SpeechEvent, string, State>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["instructions", "speed", "timestamps"],
  body: { from: fromRequest },
  // `generateContent` answers with one document shaped exactly like a streamed chunk, so it is a single frame.
  frames: (bytes, context) =>
    context.request.mode === "stream" ? Framing.sse.frame(bytes) : Framing.document.frame(bytes),
  initial: () => ({ chunks: [] }),
  step,
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  SpeechModel.fromRoute<GoogleSpeechOptions, string, State>(
    { id: ADAPTER, provider: PROVIDER, protocol, baseURL: DEFAULT_BASE_URL, path: ({ request }) => path(request) },
    input,
  )

export const GoogleSpeech = {
  protocol,
  model,
} as const
