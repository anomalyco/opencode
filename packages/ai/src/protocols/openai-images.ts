import { Effect, Encoding, Schema } from "effect"
import { Headers, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import {
  ImageModel,
  GeneratedImage,
  ImageResponse,
  type ImageInput,
  type ImageRequestFor,
  type ImageRoute,
} from "../image"
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
import { ImageInputs } from "./utils/image-input"
import { OpenAIImage } from "./utils/openai-image"

const ADAPTER = "openai-images"
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/images/generations"
export const EDIT_PATH = "/images/edits"

export type OpenAIImageString<Known extends string> = Known | (string & {})

export type OpenAIImageOptions = {
  readonly mask?: ImageInput
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

const nativeOptions = (options: OpenAIImageOptions | undefined) => {
  if (!options) return undefined
  const { mask: _, outputFormat, outputCompression, ...native } = options
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
      const mask = request.options?.mask
      if (mask !== undefined && (request.images?.length ?? 0) === 0)
        return yield* ImageInputs.invalid(ADAPTER, "An OpenAI image mask requires at least one input image")
      const http = mergeHttpOptions(request.model.http, request.http)
      const sourceImages = request.images ?? []
      const multipartImages = yield* Effect.forEach(sourceImages, (image) => {
        if (image.type === "bytes") return Effect.succeed({ data: image.data, mediaType: image.mediaType })
        if (image.type === "url") return ImageInputs.decodeDataUrl(image.url, ADAPTER)
        return Effect.succeed(undefined)
      })
      const multipartMask =
        mask === undefined
          ? undefined
          : mask.type === "bytes"
            ? { data: mask.data, mediaType: mask.mediaType }
            : mask.type === "url"
              ? yield* ImageInputs.decodeDataUrl(mask.url, ADAPTER)
              : undefined
      const useMultipart =
        sourceImages.length > 0 &&
        multipartImages.every((image) => image !== undefined) &&
        (mask === undefined || multipartMask !== undefined)
      const path = sourceImages.length === 0 ? PATH : EDIT_PATH
      const url = applyQuery(`${(input.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "")}${path}`, http?.query)

      if (useMultipart) {
        const form = new FormData()
        form.append("model", request.model.id)
        form.append("prompt", request.prompt)
        Object.entries(mergeJsonRecords(nativeOptions(request.options), http?.body) ?? {}).forEach(([key, value]) => {
          if (["model", "prompt", "image", "image[]", "images", "mask"].includes(key)) return
          form.append(key, typeof value === "string" ? value : ProviderShared.encodeJson(value))
        })
        multipartImages.forEach((image, index) => {
          if (image === undefined) return
          form.append("image[]", imageBlob(image.data, image.mediaType), `image-${index}`)
        })
        if (multipartMask !== undefined)
          form.append("mask", imageBlob(multipartMask.data, multipartMask.mediaType), "mask")
        const headers = yield* Auth.toEffect(input.auth)({
          request,
          method: "POST",
          url,
          body: "[multipart/form-data]",
          headers: Headers.remove(Headers.fromInput({ ...input.headers, ...http?.headers }), "content-type"),
        })
        const response = yield* execute(
          HttpClientRequest.post(url).pipe(HttpClientRequest.setHeaders(headers), HttpClientRequest.bodyFormData(form)),
        )
        return yield* parseResponse(response, request.options, http?.body)
      }

      const references = sourceImages.map((image) => {
        if (image.type === "bytes") return { image_url: ImageInputs.dataUrl(image) }
        if (image.type === "url") return { image_url: image.url }
        if (image.type === "file-id") return { file_id: image.id }
        return undefined
      })
      if (references.some((image) => image === undefined))
        return yield* ImageInputs.invalid(ADAPTER, "OpenAI Images accepts image URLs, data URLs, bytes, and file IDs")
      const maskReference =
        mask === undefined
          ? undefined
          : mask.type === "bytes"
            ? { image_url: ImageInputs.dataUrl(mask) }
            : mask.type === "url"
              ? { image_url: mask.url }
              : mask.type === "file-id"
                ? { file_id: mask.id }
                : undefined
      if (mask !== undefined && maskReference === undefined)
        return yield* ImageInputs.invalid(ADAPTER, "OpenAI Images accepts masks as URLs, data URLs, bytes, or file IDs")
      const requestBody = mergeJsonRecords(
        {
          model: request.model.id,
          prompt: request.prompt,
          images: references.length === 0 ? undefined : references,
          mask: maskReference,
        },
        nativeOptions(request.options),
        http?.body,
      ) as OpenAIImageBody
      const text = ProviderShared.encodeJson(requestBody)
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
      return yield* parseResponse(response, request.options, http?.body)
    }),
  }
  return ImageModel.make<OpenAIImageOptions>({ id: input.id, provider: "openai", route, http: input.http })
}

const parseResponse = Effect.fn("OpenAIImages.parseResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
  options: OpenAIImageOptions | undefined,
  overlay: Record<string, unknown> | undefined,
) {
  const payload = yield* response.json.pipe(
    Effect.mapError(() => invalidOutput("Failed to read the OpenAI Images response")),
  )
  const decoded = yield* Schema.decodeUnknownEffect(OpenAIImageResponse)(payload).pipe(
    Effect.mapError(() => invalidOutput("OpenAI Images returned an invalid response")),
  )
  const requestBody = mergeJsonRecords(nativeOptions(options), overlay)
  const format =
    decoded.output_format ?? (typeof requestBody?.output_format === "string" ? requestBody.output_format : "png")
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
})

const imageBlob = (data: Uint8Array, mediaType: string) => {
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return new Blob([buffer], { type: mediaType })
}

export const OpenAIImages = {
  model,
} as const
