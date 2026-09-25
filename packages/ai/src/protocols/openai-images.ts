import { Effect, Schema, Stream } from "effect"
import {
  ImageFinishEvent,
  ImageModel,
  ImageOutputEvent,
  ImagePartialEvent,
  type ImageEvent,
  type ImageRequestFor,
} from "../image.js"
import { Media } from "../media.js"
import { Framing } from "../route/framing.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type MediaUsage, type OpenString } from "../schema/index.js"
import { ProviderShared } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "openai-images", name: "OpenAI Images", provider: "openai" })
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/images/generations"
export const EDIT_PATH = "/images/edits"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native options. Common fields (`n`, `size`, `format`, `images`, `mask`) live on the request. */
export type OpenAIImageOptions = {
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

const OpenAIImageResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      b64_json: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      revised_prompt: Schema.optional(Schema.String),
    }),
  ),
  output_format: Schema.optional(Schema.String),
  usage: Schema.optional(Usage),
})

// ---------------------------------------------------------------------------
// 3. Streaming event schema
// ---------------------------------------------------------------------------

const StreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["image_generation.partial_image", "image_edit.partial_image"]),
    b64_json: Schema.String,
    partial_image_index: Schema.Number,
    output_format: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literals(["image_generation.completed", "image_edit.completed"]),
    b64_json: Schema.String,
    output_format: Schema.String,
    usage: Schema.optional(Usage),
  }),
])

const decodeEvent = route.decodeFrame(StreamEvent)
const decodeDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenAIImageResponse))

/** `generate` reads the whole JSON response as one frame, with the requested format for responses that omit it. */
type Frame = string | { readonly document: string; readonly requested: string | undefined }

// ---------------------------------------------------------------------------
// 4. Parser state
// ---------------------------------------------------------------------------

interface State {
  readonly completed: number
  readonly format?: string
  readonly usage?: MediaUsage
}

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** Multipart field names the route owns; `http.body` overlays cannot smuggle replacements for them. */
const RESERVED_FORM_FIELDS = new Set(["model", "prompt", "image", "image[]", "images", "mask"])

const nativeOptions = (options: OpenAIImageOptions | undefined) => {
  if (!options) return undefined
  const { outputCompression, partialImages: _, ...native } = options
  return { output_compression: outputCompression, ...native }
}

const streamOptions = (request: MediaProtocol.Addressed<Request>) => {
  if (request.mode !== "stream") return Effect.succeed(undefined)
  if (request.model.id.startsWith("dall-e"))
    return Effect.fail(
      route.unsupported("media.stream", `${request.model.id} does not stream; use Image.generate or a GPT image model`),
    )
  if (request.n !== undefined && request.n > 1)
    return Effect.fail(
      route.unsupported("media.n", `${route.name} streams one image; use Image.generate for n=${request.n}`),
    )
  return Effect.succeed({ stream: true, partial_images: request.providerOptions?.partialImages ?? 2 })
}

const isEdit = (request: Request) => (request.images?.length ?? 0) > 0

const isInline = (asset: Media.Asset) => asset.source.type === "bytes" || asset.source.type === "base64"

const reference = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, route.provider, route.name).pipe(
    Effect.map((item) => (item.type === "ref" ? { file_id: item.value } : { image_url: item.value })),
  )

const fromRequest = Effect.fn("OpenAIImages.fromRequest")(function* (request: MediaProtocol.Addressed<Request>) {
  const images = request.images ?? []
  const mask = request.mask
  if (mask !== undefined && images.length === 0)
    return yield* ProviderShared.invalidRequest("An OpenAI image mask requires at least one input image")
  const fields = mergeJsonRecords(
    { n: request.n, size: request.size, output_format: request.format, ...(yield* streamOptions(request)) },
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

  const references = yield* Effect.forEach(images, reference)
  const maskReference = mask === undefined ? undefined : yield* reference(mask)
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

const requestedFormat = (body: MediaProtocol.Body) => {
  if (body.type === "binary") return undefined
  const value = body.type === "json" ? body.value.output_format : body.value.get("output_format")
  return typeof value === "string" ? value : undefined
}

const usage = (value: Schema.Schema.Type<typeof Usage> | undefined): MediaUsage | undefined =>
  value === undefined
    ? undefined
    : {
        type: "tokens",
        input: value.input_tokens,
        output: value.output_tokens,
        total: value.total_tokens,
        details: { openai: value },
      }

const eventImage = (frame: string, label: string, data: string, format: string) =>
  MediaInput.decodedAsset((message, cause) => route.frameError(message, frame, cause), label, data, `image/${format}`, {
    info: { format },
  })

const onEvent = Effect.fn("OpenAIImages.onEvent")(function* (state: State, frame: string) {
  const event = yield* decodeEvent(frame)
  const format = event.output_format
  if ("partial_image_index" in event) {
    const image = yield* eventImage(frame, `${route.name} partial image`, event.b64_json, format)
    return [state, [ImagePartialEvent.make({ index: event.partial_image_index, image })]] as const
  }
  const image = yield* eventImage(frame, `${route.name} result ${state.completed}`, event.b64_json, format)
  return [
    { ...state, completed: state.completed + 1, format, usage: usage(event.usage) },
    [ImageOutputEvent.make({ index: state.completed, image })],
  ] as const
})

const onDocument = Effect.fn("OpenAIImages.onDocument")(function* (frame: Exclude<Frame, string>) {
  const invalid = (message: string, cause?: unknown) => route.frameError(message, frame.document, cause)
  const decoded = yield* decodeDocument(frame.document).pipe(
    Effect.mapError((cause) => invalid(`${route.name} returned an invalid response`, cause)),
  )
  const format = decoded.output_format ?? frame.requested ?? "png"
  const mediaType = `image/${format}`
  const images = yield* Effect.forEach(decoded.data, (item, index) =>
    MediaInput.imageOutput(invalid, `${route.name} result ${index}`, item, mediaType, {
      info: { format },
      providerMetadata:
        item.revised_prompt === undefined ? undefined : { openai: { revisedPrompt: item.revised_prompt } },
    }),
  )
  if (images.length === 0) return yield* invalid(`${route.name} returned no images`)
  const state: State = { completed: images.length, format, usage: usage(decoded.usage) }
  return [state, images.map((image, index) => ImageOutputEvent.make({ index, image }))] as const
})

const step = (state: State, frame: Frame) => (typeof frame === "string" ? onEvent(state, frame) : onDocument(frame))

const finish = (state: State) => {
  if (state.completed === 0) return Effect.fail(route.incomplete())
  return Effect.succeed([
    ImageFinishEvent.make({ usage: state.usage, providerMetadata: { openai: { outputFormat: state.format } } }),
  ])
}

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.stream<Request, ImageEvent, Frame, State>(route, {
  unsupported: ["aspectRatio", "seed"],
  body: { from: fromRequest },
  frames: (bytes, context) =>
    context.request.mode === "stream"
      ? Framing.sse.frame(bytes)
      : Framing.document
          .frame(bytes)
          .pipe(Stream.map((document) => ({ document, requested: requestedFormat(context.body) }))),
  initial: () => ({ completed: 0 }),
  step,
  finish,
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<OpenAIImageOptions, Frame, State>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: ({ request }) => (isEdit(request) ? EDIT_PATH : PATH) },
    input,
  )

export const OpenAIImages = {
  protocol,
  model,
} as const
