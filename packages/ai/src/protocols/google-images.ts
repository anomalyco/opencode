import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, tokenUsage, type OpenString } from "../schema/index.js"
import { ProviderShared } from "./shared.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "google-images", name: "Google Images", provider: "google" })
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native `generationConfig` fields. Common fields (`aspect`, `resolution`, `images`) live on the request. */
export type GoogleImageOptions = {
  readonly seed?: number
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
  const { thinkingLevel, includeThoughts, ...native } = request.providerOptions ?? {}
  // Google names the half tier `512` and rejects `0.5K`.
  const imageSize = request.resolution?.toUpperCase() === "0.5K" ? "512" : request.resolution?.toUpperCase()
  const imageConfig = { aspectRatio: request.aspect, imageSize }
  const thinkingConfig = { thinkingLevel, includeThoughts }
  return (
    mergeJsonRecords(
      {
        responseModalities: ["IMAGE"],
        imageConfig: Object.values(imageConfig).some((value) => value !== undefined) ? imageConfig : undefined,
        thinkingConfig: Object.values(thinkingConfig).some((value) => value !== undefined) ? thinkingConfig : undefined,
      },
      native,
    ) ?? { responseModalities: ["IMAGE"] }
  )
}

const fromRequest = Effect.fn("GoogleImages.fromRequest")(function* (request: Request) {
  if (request.n !== undefined && request.n > 1)
    return yield* route.unsupported(
      "media.n",
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
    // Safety and recitation stops are Google refusing the prompt, not a malformed response.
    if (finishReasons.some(GeminiGenerateContent.contentFiltered))
      return yield* output.contentPolicy(
        `${route.name} withheld its images (finish reasons: ${finishReasons.join(", ")})`,
      )
    return yield* output.invalid(
      `${route.name} returned no final images${
        finishReasons.length === 0 ? "" : ` (finish reasons: ${finishReasons.join(", ")})`
      }; inspect body for prompt feedback and candidate details`,
    )
  }
  const usage = decoded.usageMetadata
  const outputTokens =
    usage?.candidatesTokenCount === undefined ? undefined : usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0)
  return new ImageResponse({
    images,
    usage:
      usage === undefined
        ? undefined
        : tokenUsage({
            input: usage.promptTokenCount,
            output: outputTokens,
            total: ProviderShared.totalTokens(usage.promptTokenCount, outputTokens, usage.totalTokenCount),
            details: {
              reasoningTokens: usage.thoughtsTokenCount,
              cacheReadInputTokens: usage.cachedContentTokenCount,
              google: usage,
            },
          }),
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
