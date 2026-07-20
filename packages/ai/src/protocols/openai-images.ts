import { Effect, Encoding, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { ImageModel, GeneratedImage, ImageResponse, type ImageRequestFor, type ImageRoute } from "../image"
import { Auth, type Definition as AuthDefinition } from "../route/auth"
import {
  InvalidProviderOutputReason,
  LLMError,
  Usage,
  mergeHttpOptions,
  mergeJsonRecords,
  type HttpOptions,
} from "../schema"
import { ProviderShared } from "./shared"
import { OpenAIImage } from "./utils/openai-image"

const ADAPTER = "openai-images"
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/images/generations"

export type OpenAIImageString<Known extends string> = Known | (string & {})

export type OpenAIImageOptions = {
  readonly n?: number
  readonly size?: OpenAIImageString<
    "auto" | "256x256" | "512x512" | "1024x1024" | "1536x1024" | "1024x1536" | "1792x1024" | "1024x1792"
  >
  readonly quality?: OpenAIImageString<"auto" | "low" | "medium" | "high" | "standard" | "hd">
  readonly background?: OpenAIImageString<"auto" | "opaque" | "transparent">
  readonly moderation?: OpenAIImageString<"auto" | "low">
  readonly outputFormat?: OpenAIImageString<"png" | "jpeg" | "webp">
  readonly outputCompression?: number
} & Record<string, unknown>

export type OpenAIImageBody = Record<string, unknown> & {
  readonly model: string
  readonly prompt: string
}

const OpenAIImageResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      b64_json: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      revised_prompt: Schema.optional(Schema.String),
    }),
  ),
  output_format: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
      total_tokens: Schema.optional(Schema.Number),
      input_tokens_details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      output_tokens_details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
})

export interface ModelInput {
  readonly id: string
  readonly auth: AuthDefinition
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

const nativeOptions = (options: Record<string, unknown> | undefined) => {
  if (!options) return undefined
  const { outputFormat, outputCompression, ...native } = options
  return {
    output_format: outputFormat,
    output_compression: outputCompression,
    ...native,
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

export const model = (input: ModelInput) => {
  const route: ImageRoute<OpenAIImageOptions> = {
    id: ADAPTER,
    generate: Effect.fn("OpenAIImages.generate")(function* (request: ImageRequestFor<OpenAIImageOptions>, execute) {
      const http = mergeHttpOptions(request.model.http, request.http)
      const requestBody = mergeJsonRecords(
        { model: request.model.id, prompt: request.prompt },
        nativeOptions(request.options),
        http?.body,
      ) as OpenAIImageBody
      const text = ProviderShared.encodeJson(requestBody)
      const url = applyQuery(`${(input.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "")}${PATH}`, http?.query)
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
        Effect.mapError(() => invalidOutput("Failed to read the OpenAI Images response")),
      )
      const decoded = yield* Schema.decodeUnknownEffect(OpenAIImageResponse)(payload).pipe(
        Effect.mapError(() => invalidOutput("OpenAI Images returned an invalid response")),
      )
      const format =
        decoded.output_format ?? (typeof requestBody.output_format === "string" ? requestBody.output_format : "png")
      const images = yield* Effect.forEach(decoded.data, (item, index) => {
        if (item.b64_json)
          return Effect.fromResult(Encoding.decodeBase64(item.b64_json)).pipe(
            Effect.mapError(() => invalidOutput(`OpenAI Images result ${index} contains invalid base64 data`)),
            Effect.map(
              (data) =>
                new GeneratedImage({
                  mediaType: `image/${format}`,
                  data,
                  providerMetadata:
                    item.revised_prompt === undefined ? undefined : { openai: { revisedPrompt: item.revised_prompt } },
                }),
            ),
          )
        if (item.url)
          return Effect.succeed(
            new GeneratedImage({
              mediaType: `image/${format}`,
              data: item.url,
              providerMetadata:
                item.revised_prompt === undefined ? undefined : { openai: { revisedPrompt: item.revised_prompt } },
            }),
          )
        return Effect.fail(invalidOutput(`OpenAI Images result ${index} has neither image data nor a URL`))
      })
      if (images.length === 0) return yield* invalidOutput("OpenAI Images returned no images")
      return new ImageResponse({
        images,
        usage:
          decoded.usage === undefined
            ? undefined
            : new Usage({
                inputTokens: decoded.usage.input_tokens,
                outputTokens: decoded.usage.output_tokens,
                totalTokens: decoded.usage.total_tokens,
                providerMetadata: { openai: decoded.usage },
              }),
        providerMetadata: { openai: { outputFormat: format } },
      })
    }),
  }
  return ImageModel.make<OpenAIImageOptions>({ id: input.id, provider: "openai", route, http: input.http })
}

export const OpenAIImages = {
  model,
} as const
