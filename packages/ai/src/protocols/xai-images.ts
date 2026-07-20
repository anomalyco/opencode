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
} from "../schema"
import { ProviderShared, optionalNull } from "./shared"

const ADAPTER = "xai-images"
export const DEFAULT_BASE_URL = "https://api.x.ai/v1"
export const PATH = "/images/generations"

export type XAIImageString<Known extends string> = Known | (string & {})

export type XAIImageOptions = {
  readonly n?: number
  readonly aspectRatio?: XAIImageString<
    | "1:1"
    | "3:4"
    | "4:3"
    | "9:16"
    | "16:9"
    | "2:3"
    | "3:2"
    | "9:19.5"
    | "19.5:9"
    | "9:20"
    | "20:9"
    | "1:2"
    | "2:1"
    | "auto"
  >
  readonly aspect_ratio?: XAIImageString<
    | "1:1"
    | "3:4"
    | "4:3"
    | "9:16"
    | "16:9"
    | "2:3"
    | "3:2"
    | "9:19.5"
    | "19.5:9"
    | "9:20"
    | "20:9"
    | "1:2"
    | "2:1"
    | "auto"
  >
  readonly resolution?: XAIImageString<"1k" | "2k">
  readonly responseFormat?: XAIImageString<"url" | "b64_json">
  readonly response_format?: XAIImageString<"url" | "b64_json">
} & Record<string, unknown>

type XAIImageBody = Record<string, unknown> & {
  readonly model: string
  readonly prompt: string
}

const XAIImageResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      b64_json: optionalNull(Schema.String),
      url: optionalNull(Schema.String),
      revised_prompt: optionalNull(Schema.String),
      mime_type: optionalNull(Schema.String),
    }),
  ),
  usage: Schema.optional(Schema.Unknown),
})

export interface ModelInput {
  readonly id: string
  readonly auth: AuthDefinition
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

const nativeOptions = (options: XAIImageOptions | undefined) => {
  if (!options) return undefined
  const { aspectRatio, responseFormat, ...native } = options
  return {
    aspect_ratio: aspectRatio,
    response_format: responseFormat,
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
  const route: ImageRoute<XAIImageOptions> = {
    id: ADAPTER,
    generate: Effect.fn("XAIImages.generate")(function* (request: ImageRequestFor<XAIImageOptions>, execute) {
      const http = mergeHttpOptions(request.model.http, request.http)
      const requestBody = mergeJsonRecords(
        { model: request.model.id, prompt: request.prompt },
        nativeOptions(request.options),
        http?.body,
      ) as XAIImageBody
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
        Effect.mapError(() => invalidOutput("Failed to read the xAI Images response")),
      )
      const decoded = yield* Schema.decodeUnknownEffect(XAIImageResponse)(payload).pipe(
        Effect.mapError(() => invalidOutput("xAI Images returned an invalid response")),
      )
      const images = yield* Effect.forEach(decoded.data, (item, index) => {
        const mediaType = item.mime_type ?? "application/octet-stream"
        if (item.b64_json)
          return Effect.fromResult(Encoding.decodeBase64(item.b64_json)).pipe(
            Effect.mapError(() => invalidOutput(`xAI Images result ${index} contains invalid base64 data`)),
            Effect.map(
              (data) =>
                new GeneratedImage({
                  mediaType,
                  data,
                  providerMetadata:
                    item.revised_prompt === undefined || item.revised_prompt === null
                      ? undefined
                      : { xai: { revisedPrompt: item.revised_prompt } },
                }),
            ),
          )
        if (item.url)
          return Effect.succeed(
            new GeneratedImage({
              mediaType,
              data: item.url,
              providerMetadata:
                item.revised_prompt === undefined || item.revised_prompt === null
                  ? undefined
                  : { xai: { revisedPrompt: item.revised_prompt } },
            }),
          )
        return Effect.fail(invalidOutput(`xAI Images result ${index} has neither image data nor a URL`))
      })
      if (images.length === 0) return yield* invalidOutput("xAI Images returned no images")
      const usage = ProviderShared.isRecord(decoded.usage) ? decoded.usage : undefined
      return new ImageResponse({
        images,
        usage: usage === undefined ? undefined : new Usage({ providerMetadata: { xai: usage } }),
        providerMetadata: usage === undefined ? undefined : { xai: { usage } },
      })
    }),
  }
  return ImageModel.make<XAIImageOptions>({ id: input.id, provider: "xai", route, http: input.http })
}

export const XAIImages = {
  model,
} as const
