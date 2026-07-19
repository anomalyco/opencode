import { Effect, Encoding, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import {
  GeneratedImage,
  ImageModel,
  ImageResponse,
  type ImageModelDefaults,
  type ImageRequest,
  type ImageRoute,
} from "../image"
import { Auth, type Definition as AuthDefinition } from "../route/auth"
import { InvalidProviderOutputReason, LLMError, Usage, mergeHttpOptions, mergeJsonRecords } from "../schema"
import { ProviderShared } from "./shared"

const ADAPTER = "google-images"
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export interface GoogleImageOptions {
  readonly imageSize?: string
  readonly thinkingLevel?: string
  readonly includeThoughts?: boolean
}

const GoogleImageBody = Schema.Struct({
  contents: Schema.Array(
    Schema.Struct({
      role: Schema.Literal("user"),
      parts: Schema.Array(Schema.Struct({ text: Schema.String })),
    }),
  ),
  generationConfig: Schema.Struct({
    responseModalities: Schema.Array(Schema.Literal("IMAGE")),
    imageConfig: Schema.optional(
      Schema.Struct({
        aspectRatio: Schema.optional(Schema.String),
        imageSize: Schema.optional(Schema.String),
      }),
    ),
    seed: Schema.optional(Schema.Number),
    thinkingConfig: Schema.optional(
      Schema.Struct({
        thinkingLevel: Schema.optional(Schema.String),
        includeThoughts: Schema.optional(Schema.Boolean),
      }),
    ),
  }),
})
export type GoogleImageBody = Schema.Schema.Type<typeof GoogleImageBody>

const GoogleUsage = Schema.Struct({
  cachedContentTokenCount: Schema.optional(Schema.Number),
  thoughtsTokenCount: Schema.optional(Schema.Number),
  promptTokenCount: Schema.optional(Schema.Number),
  candidatesTokenCount: Schema.optional(Schema.Number),
  totalTokenCount: Schema.optional(Schema.Number),
  promptTokensDetails: Schema.optional(Schema.Unknown),
  candidatesTokensDetails: Schema.optional(Schema.Unknown),
})

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
  readonly defaults?: ImageModelDefaults
}

const providerOptions = (request: ImageRequest): GoogleImageOptions => ({
  ...request.model.defaults?.providerOptions?.google,
  ...request.providerOptions?.google,
})

const body = (request: ImageRequest): GoogleImageBody => {
  const options = providerOptions(request)
  const image = {
    aspectRatio: request.aspectRatio,
    imageSize: options.imageSize,
  }
  const thinkingConfig = {
    thinkingLevel: options.thinkingLevel,
    includeThoughts: options.includeThoughts,
  }
  return {
    contents: [{ role: "user", parts: [{ text: request.prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: Object.values(image).some((value) => value !== undefined) ? image : undefined,
      seed: request.seed,
      thinkingConfig: Object.values(thinkingConfig).some((value) => value !== undefined) ? thinkingConfig : undefined,
    },
  }
}

const invalidOutput = (message: string) =>
  new LLMError({
    module: ADAPTER,
    method: "generate",
    reason: new InvalidProviderOutputReason({ message, route: ADAPTER }),
  })

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
  return next.toString()
}

const PROTOCOL_BODY_FIELDS = new Set(["contents", "generationConfig"])

const bodyWithOverlay = Effect.fn("GoogleImages.bodyWithOverlay")(function* (
  imageBody: GoogleImageBody,
  overlay: Record<string, unknown> | undefined,
) {
  if (!overlay) return imageBody
  const reserved = Object.keys(overlay).filter((key) => PROTOCOL_BODY_FIELDS.has(key))
  if (reserved.length > 0)
    return yield* ProviderShared.invalidRequest(
      `http.body cannot overlay protocol-owned field(s): ${reserved.join(", ")}`,
    )
  return mergeJsonRecords(imageBody, overlay) ?? imageBody
})

export const model = (input: ModelInput) => {
  const route: ImageRoute = {
    id: ADAPTER,
    generate: Effect.fn("GoogleImages.generate")(function* (request: ImageRequest, execute) {
      if (request.count !== undefined)
        return yield* ProviderShared.invalidRequest("Google Images does not support the common count option")
      if (request.size !== undefined)
        return yield* ProviderShared.invalidRequest("Google Images does not support the common size option")

      const requestBody = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(GoogleImageBody))(body(request))
      const http = mergeHttpOptions(request.model.defaults?.http, request.http)
      const overlaidBody = yield* bodyWithOverlay(requestBody, http?.body)
      const text = ProviderShared.encodeJson(overlaidBody)
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
      const encoded = candidates.flatMap((candidate, candidateIndex) =>
        (candidate.content?.parts ?? []).flatMap((part, partIndex) =>
          part.inlineData === undefined ? [] : [{ candidate, candidateIndex, partIndex, inlineData: part.inlineData }],
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
      if (images.length === 0) return yield* invalidOutput("Google Images returned no images")
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
            text: candidates.flatMap((candidate) =>
              (candidate.content?.parts ?? []).flatMap((part) => (part.text === undefined ? [] : [part.text])),
            ),
          },
        },
      })
    }),
  }
  return ImageModel.make({ id: input.id, provider: "google", route, defaults: input.defaults })
}

export const GoogleImages = {
  model,
} as const
