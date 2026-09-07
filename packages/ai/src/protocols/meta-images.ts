import { Effect, Encoding, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { GeneratedImage, ImageModel, ImageResponse, type ImageRequestFor, type ImageRoute } from "../image.js"
import { Auth } from "../route/auth.js"
import { Usage, mergeHttpOptions, mergeJsonRecords, type HttpOptions } from "../schema/index.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { ImageInputs } from "./utils/image-input.js"

type OpenString<Known extends string> = Known | (string & {})
export type ImageOptions = {
  readonly n?: number
  /** Aspect ratio hint, not an exact output resolution. */
  readonly size?: string
  readonly outputFormat?: OpenString<"webp" | "png" | "jpeg">
  readonly responseFormat?: OpenString<"b64_json" | "url">
  readonly reasoningStrength?: OpenString<"low" | "high">
  readonly toolEnablement?: {
    readonly enable_image_search?: boolean
    readonly enable_web_search?: boolean
    readonly enable_shell?: boolean
  }
  readonly [key: string]: unknown
}

const Response = Schema.Struct({
  data: Schema.Array(Schema.Struct({ b64_json: optionalNull(Schema.String), url: optionalNull(Schema.String) })),
  output_format: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
      total_tokens: Schema.optional(Schema.Number),
    }),
  ),
})

export const model = (input: {
  readonly id: string
  readonly auth: Auth.Definition
  readonly baseURL: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}) => {
  const route: ImageRoute<ImageOptions> = {
    id: "meta-images",
    generate: Effect.fn("MetaImages.generate")(function* (request: ImageRequestFor<ImageOptions>, execute) {
      const http = mergeHttpOptions(request.model.http, request.http)
      const images = yield* Effect.forEach(request.images ?? [], (image) => {
        if (image.type === "bytes") return Effect.succeed({ image_url: ImageInputs.dataUrl(image) })
        if (image.type === "url") return Effect.succeed({ image_url: image.url })
        return ImageInputs.invalid("Meta Images accepts image bytes and URLs")
      })
      const { outputFormat, responseFormat, reasoningStrength, toolEnablement, ...native } = request.options ?? {}
      const body = ProviderShared.encodeJson(
        mergeJsonRecords(
          {
            model: request.model.id,
            prompt: request.prompt,
            images: images.length === 0 ? undefined : images,
            output_format: outputFormat,
            response_format: responseFormat,
            reasoning_strength: reasoningStrength,
            tool_enablement: toolEnablement,
          },
          native,
          http?.body,
        ),
      )
      const url = new URL(`${input.baseURL.replace(/\/$/, "")}/images/${images.length === 0 ? "generations" : "edits"}`)
      Object.entries(http?.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
      const headers = yield* Auth.toEffect(input.auth)({
        request,
        method: "POST",
        url: url.toString(),
        body,
        headers: Headers.fromInput({ ...input.headers, ...http?.headers }),
      })
      const response = yield* execute(
        HttpClientRequest.post(url.toString()).pipe(
          HttpClientRequest.setHeaders(headers),
          HttpClientRequest.bodyText(body, "application/json"),
        ),
      )
      const output = yield* ProviderShared.imageResponse("meta-images", "Meta Images", response)
      const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Response))(output.body).pipe(
        Effect.mapError((cause) => output.invalid("Meta Images returned an invalid response", cause)),
      )
      const format =
        decoded.output_format ??
        (typeof http?.body?.output_format === "string"
          ? http.body.output_format
          : typeof native.output_format === "string"
            ? native.output_format
            : (outputFormat ?? "webp"))
      const generated = yield* Effect.forEach(decoded.data, (item, index) => {
        if (item.b64_json)
          return Effect.fromResult(Encoding.decodeBase64(item.b64_json)).pipe(
            Effect.mapError((cause) => output.invalid(`Meta Images result ${index} contains invalid base64`, cause)),
            Effect.map((data) => new GeneratedImage({ mediaType: `image/${format}`, data })),
          )
        if (item.url) return Effect.succeed(new GeneratedImage({ mediaType: `image/${format}`, data: item.url }))
        return output.invalid(`Meta Images result ${index} has neither image data nor a URL`)
      })
      if (generated.length === 0) return yield* output.invalid("Meta Images returned no images")
      return new ImageResponse({
        images: generated,
        usage:
          decoded.usage === undefined
            ? undefined
            : new Usage({
                inputTokens: decoded.usage.input_tokens,
                outputTokens: decoded.usage.output_tokens,
                totalTokens: decoded.usage.total_tokens,
                providerMetadata: { meta: decoded.usage },
              }),
        providerMetadata: { meta: { outputFormat: format } },
      })
    }),
  }
  return ImageModel.make<ImageOptions>({ id: input.id, provider: "meta", route, http: input.http })
}

export * as MetaImages from "./meta-images.js"
