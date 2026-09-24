import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { ProviderShared } from "./shared.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "google-images", name: "Google Images", provider: "google" })
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native options. Common fields (`aspectRatio`, `seed`, `images`) live on the request. */
export type GoogleImageOptions = {
  readonly imageSize?: OpenString<"1K" | "2K" | "4K">
  readonly thinkingLevel?: OpenString<"MINIMAL" | "LOW" | "MEDIUM" | "HIGH">
  readonly includeThoughts?: boolean
} & Record<string, unknown>

export type Request = ImageRequestFor<GoogleImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const GoogleUsage = Schema.StructWithRest(
  Schema.Struct({
    cachedContentTokenCount: Schema.optional(Schema.Number),
    thoughtsTokenCount: Schema.optional(Schema.Number),
    promptTokenCount: Schema.optional(Schema.Number),
    candidatesTokenCount: Schema.optional(Schema.Number),
    totalTokenCount: Schema.optional(Schema.Number),
    promptTokensDetails: Schema.optional(Schema.Unknown),
    candidatesTokensDetails: Schema.optional(Schema.Unknown),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const GoogleImageResponse = Schema.Struct({
  candidates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        index: Schema.optional(Schema.Number),
        content: Schema.optional(
          Schema.Struct({
            parts: Schema.Array(
              Schema.Struct({
                text: Schema.optional(Schema.String),
                thought: Schema.optional(Schema.Boolean),
                thoughtSignature: Schema.optional(Schema.String),
                inlineData: Schema.optional(
                  Schema.Struct({
                    mimeType: Schema.String,
                    data: Schema.String,
                  }),
                ),
              }),
            ),
          }),
        ),
        finishReason: Schema.optional(Schema.String),
        finishMessage: Schema.optional(Schema.String),
        safetyRatings: Schema.optional(Schema.Unknown),
        citationMetadata: Schema.optional(Schema.Unknown),
        groundingMetadata: Schema.optional(Schema.Unknown),
      }),
    ),
  ),
  usageMetadata: Schema.optional(GoogleUsage),
  modelVersion: Schema.optional(Schema.String),
  responseId: Schema.optional(Schema.String),
  promptFeedback: Schema.optional(Schema.Unknown),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const generationConfig = (request: Request) => {
  const { imageSize, thinkingLevel, includeThoughts, ...native } = request.providerOptions ?? {}
  const imageConfig = { aspectRatio: request.aspectRatio, imageSize }
  const thinkingConfig = { thinkingLevel, includeThoughts }
  return (
    mergeJsonRecords(
      {
        responseModalities: ["IMAGE"],
        imageConfig: Object.values(imageConfig).some((value) => value !== undefined) ? imageConfig : undefined,
        seed: request.seed,
        thinkingConfig: Object.values(thinkingConfig).some((value) => value !== undefined) ? thinkingConfig : undefined,
      },
      native,
    ) ?? { responseModalities: ["IMAGE"] }
  )
}

const fromRequest = Effect.fn("GoogleImages.fromRequest")(function* (request: Request) {
  if (request.n !== undefined && request.n > 1)
    return yield* route.unsupported(
      "image.n",
      `${route.name} generates one image per request; call it once per image instead of n=${request.n}`,
    )
  const parts = yield* Effect.forEach(request.images ?? [], (image) =>
    GeminiGenerateContent.mediaPart(route.name, image),
  )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        contents: [{ role: "user", parts: [{ text: request.prompt }, ...parts] }],
        generationConfig: generationConfig(request),
      },
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(GoogleImageResponse)

const decodeResponse = Effect.fn("GoogleImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeDocument(response)
  const decoded = output.value
  const candidates = decoded.candidates ?? []
  const candidateMetadata = candidates.map((candidate, candidateIndex) => ({
    index: candidate.index ?? candidateIndex,
    finishReason: candidate.finishReason,
    finishMessage: candidate.finishMessage,
    safetyRatings: candidate.safetyRatings,
    citationMetadata: candidate.citationMetadata,
    groundingMetadata: candidate.groundingMetadata,
    parts: (candidate.content?.parts ?? []).map((part) =>
      part.inlineData === undefined
        ? { type: "text", text: part.text, thought: part.thought, thoughtSignature: part.thoughtSignature }
        : {
            type: "inlineData",
            mediaType: part.inlineData.mimeType,
            thought: part.thought,
            thoughtSignature: part.thoughtSignature,
          },
    ),
  }))
  // Thought parts are drafts; only non-thought inline data is a final image.
  const encoded = candidates.flatMap((candidate, candidateIndex) =>
    (candidate.content?.parts ?? []).flatMap((part, partIndex) =>
      part.inlineData === undefined || part.thought === true
        ? []
        : [
            {
              candidate,
              candidateIndex,
              partIndex,
              inlineData: part.inlineData,
              thoughtSignature: part.thoughtSignature,
            },
          ],
    ),
  )
  const images = yield* Effect.forEach(encoded, (item) =>
    MediaInput.decodedAsset(
      output.invalid,
      `${route.name} candidate ${item.candidateIndex} part ${item.partIndex}`,
      item.inlineData.data,
      item.inlineData.mimeType,
      {
        providerMetadata: {
          google: {
            candidateIndex: item.candidate.index ?? item.candidateIndex,
            partIndex: item.partIndex,
            finishReason: item.candidate.finishReason,
            safetyRatings: item.candidate.safetyRatings,
            citationMetadata: item.candidate.citationMetadata,
            groundingMetadata: item.candidate.groundingMetadata,
            thoughtSignature: item.thoughtSignature,
          },
        },
      },
    ),
  )
  if (images.length === 0) {
    const finishReasons = candidates.flatMap((candidate) =>
      candidate.finishReason === undefined ? [] : [candidate.finishReason],
    )
    return yield* output.invalid(
      `${route.name} returned no final images${
        finishReasons.length === 0 ? "" : ` (finish reasons: ${finishReasons.join(", ")})`
      }; inspect body for prompt feedback and candidate details`,
    )
  }
  // Candidates that stopped for a safety or policy reason are partial results, not a silent drop.
  const notices = [
    ...(decoded.promptFeedback === undefined
      ? []
      : [
          {
            type: "filtered" as const,
            message: `${route.name} reported prompt feedback`,
            providerMetadata: { google: { promptFeedback: decoded.promptFeedback } },
          },
        ]),
    ...candidates.flatMap((candidate, index) =>
      candidate.finishReason === undefined || candidate.finishReason === "STOP"
        ? []
        : [
            {
              type: "filtered" as const,
              message: `${route.name} candidate ${candidate.index ?? index} finished with ${candidate.finishReason}${
                candidate.finishMessage === undefined ? "" : `: ${candidate.finishMessage}`
              }`,
              providerMetadata: {
                google: {
                  candidateIndex: candidate.index ?? index,
                  finishReason: candidate.finishReason,
                  finishMessage: candidate.finishMessage,
                  safetyRatings: candidate.safetyRatings,
                },
              },
            },
          ],
    ),
  ]
  const usage = decoded.usageMetadata
  const outputTokens =
    usage?.candidatesTokenCount === undefined ? undefined : usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0)
  return new ImageResponse({
    images,
    notices: notices.length === 0 ? undefined : notices,
    usage:
      usage === undefined
        ? undefined
        : {
            type: "tokens",
            input: usage.promptTokenCount,
            output: outputTokens,
            total: ProviderShared.totalTokens(usage.promptTokenCount, outputTokens, usage.totalTokenCount),
            details: {
              reasoningTokens: usage.thoughtsTokenCount,
              cacheReadInputTokens: usage.cachedContentTokenCount,
              google: usage,
            },
          },
    providerMetadata: {
      google: {
        modelVersion: decoded.modelVersion,
        responseId: decoded.responseId,
        promptFeedback: decoded.promptFeedback,
        candidates: candidateMetadata,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>(route, {
  unsupported: ["mask", "size", "format"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<GoogleImageOptions>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => `/models/${request.model.id}:generateContent`,
    },
    input,
  )

export const GoogleImages = {
  protocol,
  model,
} as const
