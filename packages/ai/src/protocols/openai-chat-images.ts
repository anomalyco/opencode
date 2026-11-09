import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, ProviderID, tokenUsage } from "../schema/index.js"
import { optionalNull, ProviderShared } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

/**
 * Image output from an OpenAI-compatible `/chat/completions` endpoint, for multimodal models that return images in
 * `choices[].message.images` when asked for `modalities` (Gemini image models behind the Vercel AI Gateway). They
 * have no `/images/generations` route: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/image-generation
 */
const route = MediaProtocol.identity({ id: "openai-chat-images", name: "OpenAI Chat Images", provider: "openai" })
export const PATH = "/chat/completions"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native body fields, sent as-is. Common fields (`aspect`, `resolution`, `images`) live on the request. */
export type ChatImageOptions = Record<string, unknown>

export type Request = ImageRequestFor<ChatImageOptions>

/** Body fields that `aspect` and `resolution` lower to; hosts differ in where they read image sizing from. */
export type ChatImageSizing = (request: Request) => Record<string, unknown> | undefined

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const Usage = Schema.StructWithRest(
  Schema.Struct({
    prompt_tokens: Schema.optional(Schema.Number),
    completion_tokens: Schema.optional(Schema.Number),
    total_tokens: Schema.optional(Schema.Number),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const ChatImageResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  choices: Schema.Array(
    Schema.Struct({
      index: Schema.optional(Schema.Number),
      message: Schema.Struct({
        content: optionalNull(Schema.String),
        images: optionalNull(
          Schema.Array(
            Schema.Struct({ type: Schema.optional(Schema.String), image_url: Schema.Struct({ url: Schema.String }) }),
          ),
        ),
        provider_metadata: Schema.optional(Schema.Unknown),
      }),
      finish_reason: optionalNull(Schema.String),
    }),
  ),
  usage: Schema.optional(Usage),
})

// ---------------------------------------------------------------------------
// 3. Request body construction
// ---------------------------------------------------------------------------

const fromRequest = Effect.fn("OpenAIChatImages.fromRequest")(function* (
  request: Request,
  sizing: ChatImageSizing | undefined,
) {
  if (request.n !== undefined && request.n > 1)
    return yield* route.unsupported(
      "media.n",
      `${route.name} generates one image per request; call it once per image instead of n=${request.n}`,
    )
  const references = yield* Effect.forEach(request.images ?? [], (image) =>
    ProviderShared.mediaReference(image, undefined, route.name),
  )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: request.prompt },
              ...references.map((item) => ({ type: "image_url", image_url: { url: item.value } })),
            ],
          },
        ],
        modalities: ["image"],
        stream: false,
      },
      sizing?.(request),
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 4. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(ChatImageResponse)

const decodeResponse = (provider: ProviderID) =>
  Effect.fn("OpenAIChatImages.decodeResponse")(function* (response: HttpClientResponse.HttpClientResponse) {
    const output = yield* decodeDocument(response)
    const decoded = output.value
    const encoded = decoded.choices.flatMap((choice, choiceIndex) =>
      (choice.message.images ?? []).map((image, imageIndex) => ({ choice, choiceIndex, imageIndex, image })),
    )
    const images = yield* Effect.forEach(encoded, (item) =>
      MediaInput.imageOutput(
        output.invalid,
        `${route.name} choice ${item.choiceIndex} image ${item.imageIndex}`,
        { url: item.image.image_url.url },
        undefined,
      ),
    )
    const finishReasons = decoded.choices.flatMap((choice) =>
      choice.finish_reason === undefined || choice.finish_reason === null ? [] : [choice.finish_reason],
    )
    if (images.length === 0) {
      const text = decoded.choices
        .map((choice) => choice.message.content ?? "")
        .join(" ")
        .trim()
      const detail = [
        finishReasons.length === 0 ? undefined : `finish reasons: ${finishReasons.join(", ")}`,
        text === "" ? undefined : `text: ${text}`,
      ].filter((part) => part !== undefined)
      const suffix = detail.length === 0 ? "" : ` (${detail.join("; ")})`
      if (finishReasons.includes("content_filter"))
        return yield* output.contentPolicy(`${route.name} withheld its images${suffix}`)
      return yield* output.invalid(`${route.name} returned no images${suffix}`)
    }
    const usage = decoded.usage
    return new ImageResponse({
      images,
      usage:
        usage === undefined
          ? undefined
          : tokenUsage({
              input: usage.prompt_tokens,
              output: usage.completion_tokens,
              total: ProviderShared.totalTokens(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens),
              details: { [provider]: usage },
            }),
      providerMetadata: {
        [provider]: {
          id: decoded.id,
          model: decoded.model,
          finishReasons,
          text: decoded.choices.map((choice) => choice.message.content ?? "").join("") || undefined,
          providerMetadata: decoded.choices[0]?.message.provider_metadata,
        },
      },
    })
  })

// ---------------------------------------------------------------------------
// 5. Protocol and route
// ---------------------------------------------------------------------------

const makeProtocol = (provider: ProviderID, sizing: ChatImageSizing | undefined) => ({
  ...MediaProtocol.inline<Request, ImageResponse>(route, {
    body: { from: (request) => fromRequest(request, sizing) },
    response: { decode: decodeResponse(provider) },
  }),
  provider,
})

export const protocol = makeProtocol(route.provider, undefined)

/** `provider` attributes models, usage and metadata to the host; `sizing` places `aspect` and `resolution`. */
export const model = (
  input: MediaRoute.ModelInput & { readonly provider?: string; readonly sizing?: ChatImageSizing },
) =>
  ImageModel.fromRoute<ChatImageOptions>(
    {
      protocol:
        input.provider === undefined && input.sizing === undefined
          ? protocol
          : makeProtocol(input.provider === undefined ? route.provider : ProviderID.make(input.provider), input.sizing),
      path: PATH,
    },
    input,
  )

export const OpenAIChatImages = {
  protocol,
  model,
} as const
