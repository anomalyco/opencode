import { Effect, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { GeneratedImage, ImageModel, ImageResponse, type ImageRequestFor, type ImageRoute } from "../image"
import { Auth, type Definition as AuthDefinition } from "../route/auth"
import { InvalidProviderOutputReason, LLMError, mergeHttpOptions, mergeJsonRecords, type HttpOptions } from "../schema"
import { ProviderShared } from "./shared"
import { ImageInputs } from "./utils/image-input"

const ADAPTER = "zai-images"
export const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4"
export const PATH = "/images/generations"

export type ZAIImageString<Known extends string> = Known | (string & {})

export type ZAIImageOptions = {
  readonly size?: ZAIImageString<
    "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440"
  >
  readonly quality?: ZAIImageString<"hd" | "standard">
  readonly userID?: string
} & Record<string, unknown>

type ZAIImageBody = Record<string, unknown> & {
  readonly model: string
  readonly prompt: string
}

const ZAIImageResponse = Schema.Struct({
  created: Schema.optional(Schema.Int),
  id: Schema.optional(Schema.String),
  request_id: Schema.optional(Schema.String),
  data: Schema.Array(Schema.Struct({ url: Schema.String })),
  content_filter: Schema.optional(
    Schema.Array(
      Schema.Struct({
        role: Schema.optional(Schema.String),
        level: Schema.optional(Schema.Number),
      }),
    ),
  ),
})

export interface ModelInput {
  readonly id: string
  readonly auth: AuthDefinition
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

const nativeOptions = (options: ZAIImageOptions | undefined) => {
  if (!options) return undefined
  const { userID, ...native } = options
  return {
    user_id: userID,
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
  const route: ImageRoute<ZAIImageOptions> = {
    id: ADAPTER,
    generate: Effect.fn("ZAIImages.generate")(function* (request: ImageRequestFor<ZAIImageOptions>, execute) {
      if ((request.images?.length ?? 0) > 0)
        return yield* ImageInputs.invalid(ADAPTER, "Z.ai hosted image generation does not support image inputs")
      const http = mergeHttpOptions(request.model.http, request.http)
      const requestBody = mergeJsonRecords(
        { model: request.model.id, prompt: request.prompt },
        nativeOptions(request.options),
        http?.body,
      ) as ZAIImageBody
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
        Effect.mapError(() => invalidOutput("Failed to read the Z.ai Images response")),
      )
      const decoded = yield* Schema.decodeUnknownEffect(ZAIImageResponse)(payload).pipe(
        Effect.mapError(() => invalidOutput("Z.ai Images returned an invalid response")),
      )
      if (decoded.data.length === 0) return yield* invalidOutput("Z.ai Images returned no images")
      return new ImageResponse({
        images: decoded.data.map(
          (item) =>
            new GeneratedImage({
              mediaType: "application/octet-stream",
              data: item.url,
            }),
        ),
        providerMetadata: {
          zai: {
            created: decoded.created,
            id: decoded.id,
            requestID: decoded.request_id,
            contentFilter: decoded.content_filter,
          },
        },
      })
    }),
  }
  return ImageModel.make<ZAIImageOptions>({ id: input.id, provider: "zai", route, http: input.http })
}

export const ZAIImages = {
  model,
} as const
