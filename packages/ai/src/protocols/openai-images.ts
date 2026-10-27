import { Effect, Schema, SchemaGetter, Stream } from "effect"
import {
  ImageFinishEvent,
  ImageModel,
  ImageOutputEvent,
  ImagePartialEvent,
  type ImageEvent,
  type ImageRequestFor,
} from "../image.js"
import { Media } from "../media.js"
import { classifyProviderFailure } from "../provider-error.js"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { AIError, mergeJsonRecords, ProviderID, tokenUsage, type MediaUsage, type OpenString } from "../schema/index.js"
import { optionalNull, ProviderShared } from "./shared.js"
import { ImageSizing } from "./utils/image-sizing.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "openai-images", name: "OpenAI Images", provider: "openai" })
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/images/generations"
export const EDIT_PATH = "/images/edits"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native options. Common fields (`n`, `aspect`, `resolution`, `images`) live on the request. */
export type OpenAIImageOptions = {
  /** Exact `WIDTHxHEIGHT` or `auto`; it replaces `aspect` and `resolution`, so setting both fails. */
  readonly size?: OpenString<"auto" | "1024x1024" | "1536x1024" | "1024x1536">
  readonly outputFormat?: OpenString<"png" | "jpeg" | "webp">
  /** Inpainting mask for the first input image. */
  readonly mask?: Media.Asset
  readonly quality?: OpenString<"auto" | "low" | "medium" | "high" | "standard" | "hd">
  readonly background?: OpenString<"auto" | "opaque" | "transparent">
  readonly moderation?: OpenString<"auto" | "low">
  readonly outputCompression?: number
  /** Previews sent before the final image when streaming (default 2); ignored by `Image.generate`. */
  readonly partialImages?: number
} & Record<string, unknown>

export type Request = ImageRequestFor<OpenAIImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const Usage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
  input_tokens_details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  output_tokens_details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

/** What the provider actually rendered; it can differ from the request when `auto` or a default applied. */
const Settings = {
  output_format: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  quality: Schema.optional(Schema.String),
  background: Schema.optional(Schema.String),
}

const OpenAIImageResponse = Schema.Struct({
  // `response_format` picks `b64_json` or `url`; DALL·E and many compatible hosts default to `url`.
  data: Schema.Array(Schema.Struct({ b64_json: optionalNull(Schema.String), url: optionalNull(Schema.String) })),
  ...Settings,
  usage: Schema.optional(Usage),
})

// ---------------------------------------------------------------------------
// 3. Streaming event schema
// ---------------------------------------------------------------------------

const EVENT_TYPES = new Set([
  "image_generation.partial_image",
  "image_edit.partial_image",
  "image_generation.completed",
  "image_edit.completed",
  "error",
])
/** OpenAI may add stream event types; frames outside `EVENT_TYPES` are ignored, while a malformed known type still fails decoding. */
const UnknownEvent = Schema.Struct({
  type: Schema.String.check(Schema.makeFilter((type) => !EVENT_TYPES.has(type))),
}).pipe(
  Schema.decodeTo(Schema.Struct({ type: Schema.Literal("unknown"), rawType: Schema.String }), {
    decode: SchemaGetter.transform((event) => ({ type: "unknown" as const, rawType: event.type })),
    encode: SchemaGetter.forbidden(() => "Unknown OpenAI Images stream events are decode-only"),
  }),
)
const StreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["image_generation.partial_image", "image_edit.partial_image"]),
    b64_json: Schema.String,
    partial_image_index: Schema.Number,
    ...Settings,
    output_format: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literals(["image_generation.completed", "image_edit.completed"]),
    b64_json: Schema.String,
    ...Settings,
    output_format: Schema.String,
    usage: Schema.optional(Usage),
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
  }),
  UnknownEvent,
])

const decodeEvent = route.decodeFrame(StreamEvent)
const decodeDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenAIImageResponse))

/** `generate` reads the whole JSON response as one frame. */
type Frame = string | { readonly document: string }

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

interface State {
  readonly completed: number
  readonly format?: string
  readonly size?: string
  readonly quality?: string
  readonly background?: string
  readonly usage?: Schema.Schema.Type<typeof Usage>
}

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** Multipart field names the route owns; `http.body` overlays cannot smuggle replacements for them. */
const RESERVED_FORM_FIELDS = new Set(["model", "prompt", "image", "image[]", "images", "mask"])

const nativeOptions = (options: OpenAIImageOptions | undefined) => {
  if (!options) return undefined
  const { outputCompression, outputFormat, partialImages: _, mask: __, ...native } = options
  return { output_compression: outputCompression, output_format: outputFormat, ...native }
}

/**
 * `gpt-image-1`, `chatgpt-image` and DALL·E take a fixed list, `gpt-image-2` and later any size within limits. Other
 * models are gateway-hosted (`bfl/flux-2-pro`); the gateway passes `size` through to them as is.
 */
const sizes = (model: string): ImageSizing.Limits | ReadonlyArray<ImageSizing.Size> => {
  const id = model.slice(model.lastIndexOf("/") + 1)
  if (id.startsWith("dall-e-2")) return [256, 512, 1024].map((edge) => ({ width: edge, height: edge }))
  if (id.startsWith("dall-e-3"))
    return [
      { width: 1024, height: 1024 },
      { width: 1792, height: 1024 },
      { width: 1024, height: 1792 },
    ]
  if (/^(gpt-image-1|chatgpt-image)/.test(id))
    return [
      { width: 1024, height: 1024 },
      { width: 1536, height: 1024 },
      { width: 1024, height: 1536 },
    ]
  if (id.startsWith("gpt-image-"))
    return { multiple: 16, maxEdge: 3840, minPixels: 655_360, maxPixels: 8_294_400, maxRatio: 3 }
  return { multiple: 16 }
}

const size = (request: Request) => {
  if (!ImageSizing.isRequested(request)) return undefined
  const options = sizes(request.model.id)
  return "multiple" in options ? ImageSizing.fit(request, options) : ImageSizing.nearest(request, options)
}

const streamOptions = (request: MediaProtocol.Addressed<Request>) => {
  if (request.mode !== "stream") return Effect.succeed(undefined)
  if (request.n !== undefined && request.n > 1)
    return Effect.fail(
      route.unsupported("media.n", `${route.name} streams one image; use Image.generate for n=${request.n}`),
    )
  return Effect.succeed({ stream: true, partial_images: request.providerOptions?.partialImages ?? 2 })
}

const isEdit = (request: Request) => (request.images?.length ?? 0) > 0

const isInline = (asset: Media.Asset) => asset.source.type === "bytes" || asset.source.type === "base64"

const reference = (asset: Media.Asset, provider: ProviderID) =>
  ProviderShared.mediaReference(asset, provider, route.name).pipe(
    Effect.map((item) => (item.type === "ref" ? { file_id: item.value } : { image_url: item.value })),
  )

const fromRequest = Effect.fn("OpenAIImages.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  const images = request.images ?? []
  const mask = request.providerOptions?.mask
  if (mask !== undefined && images.length === 0)
    return yield* ProviderShared.invalidRequest("An OpenAI image mask requires at least one input image")
  if (request.providerOptions?.size !== undefined && ImageSizing.isRequested(request))
    return yield* ProviderShared.invalidRequest(
      "OpenAI providerOptions.size replaces aspect and resolution; set one or the other",
    )
  const chosen = size(request)
  const fields = mergeJsonRecords(
    {
      n: request.n,
      size: chosen === undefined ? undefined : `${chosen.width}x${chosen.height}`,
      ...(yield* streamOptions(request)),
    },
    nativeOptions(request.providerOptions),
    request.http?.body,
  )

  // Owned bytes go through multipart edits; remote URLs and file IDs use the JSON edits body instead.
  if (images.length > 0 && images.every(isInline) && (mask === undefined || isInline(mask))) {
    const form = new FormData()
    MediaInput.appendFields(
      form,
      { model: request.model.id, prompt: request.prompt },
      { overlay: fields, reserved: RESERVED_FORM_FIELDS },
    )
    const uploads = yield* Effect.forEach(images, (image) => MediaInput.inlineBytes(route.id, image))
    uploads.forEach((data, index) =>
      form.append("image[]", MediaInput.blob(data, images[index].mediaType), `image-${index}`),
    )
    if (mask !== undefined)
      form.append("mask", MediaInput.blob(yield* MediaInput.inlineBytes(route.id, mask), mask.mediaType), "mask")
    return MediaProtocol.multipart(form)
  }

  const references = yield* Effect.forEach(images, (image) => reference(image, request.model.provider))
  const maskReference = mask === undefined ? undefined : yield* reference(mask, request.model.provider)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        images: references.length === 0 ? undefined : references,
        mask: maskReference,
      },
      fields,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Stream parsing
// ---------------------------------------------------------------------------

const usage = (value: Schema.Schema.Type<typeof Usage> | undefined, provider: ProviderID): MediaUsage | undefined =>
  value === undefined
    ? undefined
    : tokenUsage({
        input: value.input_tokens,
        output: value.output_tokens,
        total: value.total_tokens,
        details: { [provider]: value },
      })

/** `size` echoes the rendered `WIDTHxHEIGHT`; `auto` or any other value leaves the dimensions unknown. */
const info = (format: string | undefined, size: string | undefined): Media.Info => {
  const match = size?.match(/^(\d+)x(\d+)$/)
  return match ? { format, width: Number(match[1]), height: Number(match[2]) } : { format }
}

const eventImage = (frame: string, label: string, data: string, format: string, size: string | undefined) =>
  MediaInput.decodedAsset((message, cause) => route.frameError(message, frame, cause), label, data, `image/${format}`, {
    info: info(format, size),
  })

const onEvent = Effect.fnUntraced(function* (state: State, frame: string) {
  const event = yield* decodeEvent(frame)
  if (event.type === "unknown") return [state, []] as const
  if (event.type === "error")
    return yield* new AIError({
      reason: classifyProviderFailure({
        message: `${route.name} stream failed: ${event.error?.message ?? "unknown error"}`,
        rawBody: frame,
      }),
    })
  const format = event.output_format
  if ("partial_image_index" in event) {
    const image = yield* eventImage(frame, `${route.name} partial image`, event.b64_json, format, event.size)
    return [state, [ImagePartialEvent.make({ index: event.partial_image_index, image })]] as const
  }
  const image = yield* eventImage(frame, `${route.name} result ${state.completed}`, event.b64_json, format, event.size)
  return [
    {
      completed: state.completed + 1,
      format,
      size: event.size,
      quality: event.quality,
      background: event.background,
      usage: event.usage,
    },
    [ImageOutputEvent.make({ index: state.completed, image })],
  ] as const
})

const onDocument = Effect.fnUntraced(function* (frame: Exclude<Frame, string>) {
  const invalid = (message: string, cause?: unknown) => route.frameError(message, frame.document, cause)
  const decoded = yield* decodeDocument(frame.document).pipe(
    Effect.mapError((cause) => invalid(`${route.name} returned an invalid response`, cause)),
  )
  // Compatible hosts may omit `output_format` and ignore the requested one, so the bytes decide unreported types.
  const format = decoded.output_format
  const mediaType = format === undefined ? undefined : `image/${format}`
  const images = yield* Effect.forEach(decoded.data, (item, index) =>
    MediaInput.imageOutput(invalid, `${route.name} result ${index}`, item, mediaType, {
      info: info(format, decoded.size),
    }),
  )
  if (images.length === 0) return yield* invalid(`${route.name} returned no images`)
  const state: State = {
    completed: images.length,
    format,
    size: decoded.size,
    quality: decoded.quality,
    background: decoded.background,
    usage: decoded.usage,
  }
  return [state, images.map((image, index) => ImageOutputEvent.make({ index, image }))] as const
})

const step = (state: State, frame: Frame) => (typeof frame === "string" ? onEvent(state, frame) : onDocument(frame))

const finish = (state: State, context: MediaProtocol.ResponseContext<Request>) => {
  if (state.completed === 0) return Effect.fail(route.incomplete())
  const provider = context.request.model.provider
  return Effect.succeed([
    ImageFinishEvent.make({
      usage: usage(state.usage, provider),
      providerMetadata: {
        [provider]: {
          outputFormat: state.format,
          size: state.size,
          quality: state.quality,
          background: state.background,
        },
      },
    }),
  ])
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, ImageEvent, Frame, State>(route, {
  body: { from: fromRequest },
  frames: (bytes, context) =>
    context.request.mode === "stream"
      ? Framing.sse.frame(bytes)
      : Framing.document.frame(bytes).pipe(Stream.map((document) => ({ document }))),
  initial: () => ({ completed: 0 }),
  step,
  finish,
})

/** `provider` attributes models, refs, and metadata to an OpenAI-compatible host; it defaults to `openai`. */
export const model = (input: MediaRoute.ModelInput & { readonly provider?: string }) =>
  ImageModel.fromRoute<OpenAIImageOptions, Frame, State>(
    {
      protocol: input.provider === undefined ? protocol : { ...protocol, provider: ProviderID.make(input.provider) },
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => (isEdit(request) ? EDIT_PATH : PATH),
    },
    input,
  )

export const OpenAIImages = {
  protocol,
  model,
} as const
