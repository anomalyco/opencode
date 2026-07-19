import { Effect, Encoding, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import {
  ImageModel,
  GeneratedImage,
  ImageResponse,
  type ImageRequest,
  type ImageModelDefaults,
  type ImageRoute,
} from "../image"
import { Auth, type Definition as AuthDefinition } from "../route/auth"
import { InvalidProviderOutputReason, LLMError, Usage } from "../schema"
import { ProviderShared } from "./shared"

const ADAPTER = "openai-images"
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/images/generations"

export interface OpenAIImageOptions {
  readonly quality?: "auto" | "low" | "medium" | "high"
  readonly background?: "auto" | "opaque" | "transparent"
  readonly moderation?: "auto" | "low"
  readonly outputFormat?: "png" | "jpeg" | "webp"
  readonly outputCompression?: number
}

const OpenAIImageBody = Schema.Struct({
  model: Schema.String,
  prompt: Schema.String,
  n: Schema.optional(Schema.Number),
  size: Schema.optional(Schema.String),
  quality: Schema.optional(Schema.Literals(["auto", "low", "medium", "high"])),
  background: Schema.optional(Schema.Literals(["auto", "opaque", "transparent"])),
  moderation: Schema.optional(Schema.Literals(["auto", "low"])),
  output_format: Schema.optional(Schema.Literals(["png", "jpeg", "webp"])),
  output_compression: Schema.optional(Schema.Number),
})
export type OpenAIImageBody = Schema.Schema.Type<typeof OpenAIImageBody>

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
  readonly defaults?: ImageModelDefaults
}

const providerOptions = (request: ImageRequest): OpenAIImageOptions => ({
  ...request.model.defaults?.providerOptions?.openai,
  ...request.providerOptions?.openai,
})

const body = (request: ImageRequest): OpenAIImageBody => {
  const options = providerOptions(request)
  return {
    model: request.model.id,
    prompt: request.prompt,
    n: request.count,
    size: request.size === undefined ? undefined : `${request.size.width}x${request.size.height}`,
    quality: options.quality,
    background: options.background,
    moderation: options.moderation,
    output_format: options.outputFormat,
    output_compression: options.outputCompression,
  }
}

const invalidOutput = (message: string) =>
  new LLMError({
    module: ADAPTER,
    method: "generate",
    reason: new InvalidProviderOutputReason({ message, route: ADAPTER }),
  })

export const model = (input: ModelInput) => {
  const route: ImageRoute = {
    id: ADAPTER,
    generate: Effect.fn("OpenAIImages.generate")(function* (request: ImageRequest, execute) {
      if (request.aspectRatio !== undefined)
        return yield* ProviderShared.invalidRequest("OpenAI Images does not support the common aspectRatio option")
      if (request.seed !== undefined)
        return yield* ProviderShared.invalidRequest("OpenAI Images does not support the common seed option")

      const requestBody = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(OpenAIImageBody))(body(request))
      const text = Schema.encodeSync(Schema.fromJsonString(OpenAIImageBody))(requestBody)
      const url = `${(input.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "")}${PATH}`
      const http = request.http ?? request.model.defaults?.http
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
      const format = decoded.output_format ?? providerOptions(request).outputFormat ?? "png"
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
  return ImageModel.make({ id: input.id, provider: "openai", route, defaults: input.defaults })
}

export const OpenAIImages = {
  model,
} as const
