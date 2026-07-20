import { Effect, Encoding, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { GeneratedImage, ImageModel, ImageResponse, type ImageRequestFor, type ImageRoute } from "../image"
import { Auth, type Definition as AuthDefinition } from "../route/auth"
import {
  InvalidProviderOutputReason,
  LLMError,
  Usage,
  mergeHttpOptions,
  mergeJsonRecords,
  type HttpOptions,
  type ProviderMetadata,
} from "../schema"
import { ProviderShared } from "./shared"

const ADAPTER = "google-images"
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export type GoogleImageString<Known extends string> = Known | (string & {})

export type GoogleImageOptions = {
  readonly aspectRatio?: GoogleImageString<
    "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9"
  >
  readonly imageSize?: GoogleImageString<"1K" | "2K" | "4K">
  readonly seed?: number
  readonly thinkingLevel?: GoogleImageString<"MINIMAL" | "LOW" | "MEDIUM" | "HIGH">
  readonly includeThoughts?: boolean
} & Record<string, unknown>

export type GoogleImageBody = Record<string, unknown> & {
  readonly contents: ReadonlyArray<{
    readonly role: "user"
    readonly parts: ReadonlyArray<{ readonly text: string }>
  }>
  readonly generationConfig: Record<string, unknown>
}

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

export interface ModelInput {
  readonly id: string
  readonly auth: AuthDefinition
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

const nativeOptions = (options: GoogleImageOptions | undefined) => {
  const { aspectRatio, imageSize, seed, thinkingLevel, includeThoughts, ...native } = options ?? {}
  const image = {
    aspectRatio,
    imageSize,
  }
  const thinkingConfig = {
    thinkingLevel,
    includeThoughts,
  }
  return (
    mergeJsonRecords(
      {
        responseModalities: ["IMAGE"],
        imageConfig: Object.values(image).some((value) => value !== undefined) ? image : undefined,
        seed,
        thinkingConfig: Object.values(thinkingConfig).some((value) => value !== undefined) ? thinkingConfig : undefined,
      },
      native,
    ) ?? { responseModalities: ["IMAGE"] }
  )
}

const body = (request: ImageRequestFor<GoogleImageOptions>, overlay: Record<string, unknown> | undefined) =>
  mergeJsonRecords(
    {
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: nativeOptions(request.options),
    },
    overlay,
  ) as GoogleImageBody

const invalidOutput = (message: string, providerMetadata?: ProviderMetadata) =>
  new LLMError({
    module: ADAPTER,
    method: "generate",
    reason: new InvalidProviderOutputReason({ message, route: ADAPTER, providerMetadata }),
  })

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
  return next.toString()
}

export const model = (input: ModelInput) => {
  const route: ImageRoute<GoogleImageOptions> = {
    id: ADAPTER,
    generate: Effect.fn("GoogleImages.generate")(function* (request: ImageRequestFor<GoogleImageOptions>, execute) {
      const http = mergeHttpOptions(request.model.http, request.http)
      const text = ProviderShared.encodeJson(body(request, http?.body))
      const url = applyQuery(
        `${(input.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/models/${request.model.id}:generateContent`,
        http?.query,
      )
      const headers = yield* Auth.toEffect(input.auth)({
        request,
        method: "POST",
        url,
        body: text,
        headers: Headers.fromInput({ ...input.headers, ...http?.headers }),
      })
      const response = yield* execute(
        HttpClientRequest.post(url).pipe(
          HttpClientRequest.setHeaders(headers),
          HttpClientRequest.bodyText(text, "application/json"),
        ),
      )
      const payload = yield* response.json.pipe(
        Effect.mapError(() => invalidOutput("Failed to read the Google Images response")),
      )
      const decoded = yield* Schema.decodeUnknownEffect(GoogleImageResponse)(payload).pipe(
        Effect.mapError(() => invalidOutput("Google Images returned an invalid response")),
      )
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
            ? {
                type: "text",
                text: part.text,
                thought: part.thought,
                thoughtSignature: part.thoughtSignature,
              }
            : {
                type: "inlineData",
                mediaType: part.inlineData.mimeType,
                thought: part.thought,
                thoughtSignature: part.thoughtSignature,
              },
        ),
      }))
      const encoded = candidates.flatMap((candidate, candidateIndex) =>
        (candidate.content?.parts ?? []).flatMap((part, partIndex) =>
          part.inlineData === undefined || part.thought === true
            ? []
            : [{ candidate, candidateIndex, partIndex, inlineData: part.inlineData }],
        ),
      )
      const images = yield* Effect.forEach(encoded, (item) =>
        Effect.fromResult(Encoding.decodeBase64(item.inlineData.data)).pipe(
          Effect.mapError(() =>
            invalidOutput(
              `Google Images candidate ${item.candidateIndex} part ${item.partIndex} contains invalid base64 data`,
            ),
          ),
          Effect.map(
            (data) =>
              new GeneratedImage({
                mediaType: item.inlineData.mimeType,
                data,
                providerMetadata: {
                  google: {
                    candidateIndex: item.candidate.index ?? item.candidateIndex,
                    partIndex: item.partIndex,
                    finishReason: item.candidate.finishReason,
                    safetyRatings: item.candidate.safetyRatings,
                    citationMetadata: item.candidate.citationMetadata,
                    groundingMetadata: item.candidate.groundingMetadata,
                    thoughtSignature: item.candidate.content?.parts[item.partIndex]?.thoughtSignature,
                  },
                },
              }),
          ),
        ),
      )
      if (images.length === 0) {
        const finishReasons = candidates.flatMap((candidate) =>
          candidate.finishReason === undefined ? [] : [candidate.finishReason],
        )
        return yield* invalidOutput(
          `Google Images returned no final images${
            finishReasons.length === 0 ? "" : ` (finish reasons: ${finishReasons.join(", ")})`
          }; inspect reason.providerMetadata.google for prompt feedback and candidate details`,
          {
            google: {
              promptFeedback: decoded.promptFeedback,
              candidates: candidateMetadata,
            },
          },
        )
      }
      const usage = decoded.usageMetadata
      const outputTokens =
        usage?.candidatesTokenCount === undefined
          ? undefined
          : usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0)
      return new ImageResponse({
        images,
        usage:
          usage === undefined
            ? undefined
            : new Usage({
                inputTokens: usage.promptTokenCount,
                outputTokens,
                nonCachedInputTokens: ProviderShared.subtractTokens(
                  usage.promptTokenCount,
                  usage.cachedContentTokenCount,
                ),
                cacheReadInputTokens: usage.cachedContentTokenCount,
                reasoningTokens: usage.thoughtsTokenCount,
                totalTokens: ProviderShared.totalTokens(usage.promptTokenCount, outputTokens, usage.totalTokenCount),
                providerMetadata: { google: usage },
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
    }),
  }
  return ImageModel.make<GoogleImageOptions>({ id: input.id, provider: "google", route, http: input.http })
}

export const GoogleImages = {
  model,
} as const
