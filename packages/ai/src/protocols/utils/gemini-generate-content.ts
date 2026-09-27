import { Effect, Schema, type Stream } from "effect"
import type { Media } from "../../media.js"
import { Framing } from "../../route/framing.js"
import type { MediaProtocol } from "../../route/media-protocol.js"
import { AIError, ContentPolicyError, ProviderID, type MediaUsage, type ProviderMetadata } from "../../schema/index.js"
import { ProviderShared } from "../shared.js"
import { MediaInput } from "./media-input.js"

const PROVIDER = ProviderID.make("google")

const UsageMetadata = Schema.Struct({
  promptTokenCount: Schema.optional(Schema.Number),
  candidatesTokenCount: Schema.optional(Schema.Number),
  totalTokenCount: Schema.optional(Schema.Number),
})
type UsageMetadata = Schema.Schema.Type<typeof UsageMetadata>

export const chunk = <const Part extends Schema.Top>(part: Part) =>
  Schema.Struct({
    candidates: Schema.optional(
      Schema.Array(
        Schema.Struct({
          content: Schema.optional(Schema.Struct({ parts: Schema.optional(Schema.Array(part)) })),
          finishReason: Schema.optional(Schema.String),
        }),
      ),
    ),
    promptFeedback: Schema.optional(
      Schema.Struct({
        blockReason: Schema.optional(Schema.String),
        blockReasonMessage: Schema.optional(Schema.String),
      }),
    ),
    usageMetadata: Schema.optional(UsageMetadata),
    modelVersion: Schema.optional(Schema.String),
    responseId: Schema.optional(Schema.String),
  })

interface Chunk {
  readonly candidates?: ReadonlyArray<{ readonly finishReason?: string }>
  readonly promptFeedback?: { readonly blockReason?: string; readonly blockReasonMessage?: string }
  readonly usageMetadata?: UsageMetadata
  readonly modelVersion?: string
  readonly responseId?: string
}

export interface Metadata {
  readonly usage?: UsageMetadata
  readonly finishReason?: string
  readonly modelVersion?: string
  readonly responseId?: string
}

export const track = <State extends Metadata>(state: State, chunk: Chunk): State => ({
  ...state,
  usage: chunk.usageMetadata ?? state.usage,
  finishReason: chunk.candidates?.[0]?.finishReason ?? state.finishReason,
  modelVersion: chunk.modelVersion ?? state.modelVersion,
  responseId: chunk.responseId ?? state.responseId,
})

export const blocked = (name: string, chunk: Chunk, frame: string) => {
  const feedback = chunk.promptFeedback
  if (feedback?.blockReason === undefined) return undefined
  return new AIError({
    reason: new ContentPolicyError({
      message: `${name} blocked the request (${feedback.blockReason})${
        feedback.blockReasonMessage === undefined ? "" : `: ${feedback.blockReasonMessage}`
      }`,
      body: frame,
    }),
  })
}

export const usage = (usage: UsageMetadata | undefined): MediaUsage | undefined =>
  usage === undefined
    ? undefined
    : {
        type: "tokens",
        input: usage.promptTokenCount,
        output: usage.candidatesTokenCount,
        total: ProviderShared.totalTokens(usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount),
        details: { google: usage },
      }

export const providerMetadata = (state: Metadata): ProviderMetadata => ({
  google: { finishReason: state.finishReason, modelVersion: state.modelVersion, responseId: state.responseId },
})

export const path = (model: string, mode: MediaProtocol.Mode) =>
  mode === "stream" ? `/models/${model}:streamGenerateContent?alt=sse` : `/models/${model}:generateContent`

// `generateContent` answers with one document shaped exactly like a streamed chunk, so it is a single frame.
export const frames = (bytes: Stream.Stream<Uint8Array, AIError>, mode: MediaProtocol.Mode) =>
  mode === "stream" ? Framing.sse.frame(bytes) : Framing.document.frame(bytes)

// Gemini does not fetch public URLs; inline payloads and Gemini Files references are the accepted inputs.
export const mediaPart = (
  route: string,
  asset: Media.Asset,
): Effect.Effect<
  | { readonly fileData: { readonly mimeType: string; readonly fileUri: string } }
  | { readonly inlineData: { readonly mimeType: string; readonly data: string } },
  AIError
> => {
  const fileUri = MediaInput.refID(asset, PROVIDER)
  if (fileUri !== undefined) return Effect.succeed({ fileData: { mimeType: asset.mediaType, fileUri } })
  return ProviderShared.requireInlineMedia(route, asset).pipe(
    Effect.map((media) => ({ inlineData: { mimeType: media.mime, data: media.base64 } })),
  )
}

export * as GeminiGenerateContent from "./gemini-generate-content.js"
