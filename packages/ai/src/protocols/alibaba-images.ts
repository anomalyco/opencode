import { Effect, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { GeneratedImage, ImageModel, ImageResponse, type ImageRequestFor, type ImageRoute } from "../image"
import { Auth, type Definition as AuthDefinition } from "../route/auth"
import {
  InvalidProviderOutputReason,
  LLMError,
  UnknownProviderReason,
  Usage,
  mergeHttpOptions,
  mergeJsonRecords,
  type HttpOptions,
} from "../schema"
import { ProviderShared } from "./shared"
import { ImageInputs } from "./utils/image-input"

const ADAPTER = "alibaba-images"
export const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1"
export const PATH = "/services/aigc/multimodal-generation/generation"

export type AlibabaImageString<Known extends string> = Known | (string & {})

export interface AlibabaColor {
  readonly hex: string
  readonly ratio: string
}

export type AlibabaImageOptions = {
  readonly n?: number
  readonly size?: string
  readonly resolution?: AlibabaImageString<"1K" | "2K" | "4K">
  readonly negativePrompt?: string
  readonly promptExtend?: boolean
  readonly thinkingMode?: boolean
  readonly colorPalette?: ReadonlyArray<AlibabaColor>
  readonly watermark?: boolean
  readonly seed?: number
} & Record<string, unknown>

export type AlibabaImageBody = Record<string, unknown> & {
  readonly model: string
  readonly input: {
    readonly messages: ReadonlyArray<{
      readonly role: "user"
      readonly content: ReadonlyArray<{ readonly image: string } | { readonly text: string }>
    }>
  }
  readonly parameters: Record<string, unknown>
}

const AlibabaResponse = Schema.Struct({
  output: Schema.optional(
    Schema.Struct({
      choices: Schema.Array(
        Schema.Struct({
          finish_reason: Schema.optional(Schema.String),
          message: Schema.Struct({
            role: Schema.optional(Schema.String),
            content: Schema.Array(
              Schema.Struct({
                image: Schema.String,
                type: Schema.optional(Schema.String),
              }),
            ),
          }),
        }),
      ),
      finished: Schema.optional(Schema.Boolean),
    }),
  ),
  usage: Schema.optional(
    Schema.Struct({
      image_count: Schema.optional(Schema.Number),
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
      total_tokens: Schema.optional(Schema.Number),
      width: Schema.optional(Schema.Number),
      height: Schema.optional(Schema.Number),
      size: Schema.optional(Schema.String),
    }),
  ),
  request_id: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})

export interface ModelInput {
  readonly id: string
  readonly auth: AuthDefinition
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

const nativeOptions = (options: AlibabaImageOptions | undefined) => {
  if (!options) return undefined
  const { resolution, negativePrompt, promptExtend, thinkingMode, colorPalette, ...native } = options
  return {
    size: resolution,
    negative_prompt: negativePrompt,
    prompt_extend: promptExtend,
    thinking_mode: thinkingMode,
    color_palette: colorPalette,
    ...native,
  }
}

const invalidOutput = (message: string, metadata?: Record<string, unknown>) =>
  new LLMError({
    module: ADAPTER,
    method: "generate",
    reason: new InvalidProviderOutputReason({
      message,
      route: ADAPTER,
      providerMetadata: metadata === undefined ? undefined : { alibaba: metadata },
    }),
  })

const providerError = (code: string | undefined, message: string | undefined, requestID: string | undefined) =>
  new LLMError({
    module: ADAPTER,
    method: "generate",
    reason: new UnknownProviderReason({
      message: [code, message].filter(Boolean).join(": ") || "Alibaba image generation failed",
      providerMetadata: { alibaba: { code, requestId: requestID } },
    }),
  })

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
  return next.toString()
}

const expiration = (url: string) => {
  if (!URL.canParse(url)) return undefined
  const value = new URL(url).searchParams.get("Expires")
  if (value === null || !Number.isFinite(Number(value))) return undefined
  const date = new Date(Number(value) * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export const model = (input: ModelInput) => {
  const route: ImageRoute<AlibabaImageOptions> = {
    id: ADAPTER,
    generate: Effect.fn("AlibabaImages.generate")(function* (request: ImageRequestFor<AlibabaImageOptions>, execute) {
      const content = yield* Effect.forEach(request.images ?? [], (image) => {
        if (image.type === "bytes") return Effect.succeed({ image: ImageInputs.dataUrl(image) })
        if (image.type === "url") return Effect.succeed({ image: image.url })
        return ImageInputs.invalid(ADAPTER, "Alibaba Images accepts image URLs, data URLs, and bytes")
      })
      const requestBody: AlibabaImageBody = {
        model: request.model.id,
        input: { messages: [{ role: "user", content: [...content, { text: request.prompt }] }] },
        parameters: nativeOptions(request.options) ?? {},
      }
      const http = mergeHttpOptions(request.model.http, request.http)
      const overlay = mergeJsonRecords(requestBody, http?.body) ?? requestBody
      const body: AlibabaImageBody = {
        ...overlay,
        model: requestBody.model,
        input: requestBody.input,
        parameters:
          overlay.parameters !== null && typeof overlay.parameters === "object" && !Array.isArray(overlay.parameters)
            ? (overlay.parameters as Record<string, unknown>)
            : requestBody.parameters,
      }
      const text = ProviderShared.encodeJson(body)
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
        Effect.mapError(() => invalidOutput("Failed to read the Alibaba Images response")),
      )
      const decoded = yield* Schema.decodeUnknownEffect(AlibabaResponse)(payload).pipe(
        Effect.mapError(() => invalidOutput("Alibaba Images returned an invalid response")),
      )
      if (decoded.code !== undefined || decoded.output === undefined)
        return yield* providerError(decoded.code, decoded.message, decoded.request_id)
      const urls = decoded.output.choices.flatMap((choice) => choice.message.content.map((item) => item.image))
      if (urls.length === 0)
        return yield* invalidOutput("Alibaba Images returned no images", { requestId: decoded.request_id })

      return new ImageResponse({
        images: urls.map(
          (url) =>
            new GeneratedImage({
              mediaType: "image/png",
              data: url,
              expiresAt: expiration(url),
              providerMetadata: { alibaba: { modelId: request.model.id } },
            }),
        ),
        usage:
          decoded.usage === undefined
            ? undefined
            : new Usage({
                inputTokens: decoded.usage.input_tokens,
                outputTokens: decoded.usage.output_tokens,
                totalTokens: decoded.usage.total_tokens,
                providerMetadata: { alibaba: decoded.usage },
              }),
        providerMetadata: { alibaba: { requestId: decoded.request_id, modelId: request.model.id } },
      })
    }),
  }
  return ImageModel.make<AlibabaImageOptions>({
    id: input.id,
    provider: "alibaba",
    route,
    http: input.http,
  })
}

export const AlibabaImages = {
  model,
} as const
