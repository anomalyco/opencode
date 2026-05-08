import { Effect, Schema } from "effect"
import type { MediaPart } from "../../schema"
import { ProviderShared } from "../shared"

// Bedrock Converse accepts image `format` as the file extension and
// `source.bytes` as base64 in the JSON wire format.
export const ImageFormat = Schema.Literals(["png", "jpeg", "gif", "webp"])
export type ImageFormat = Schema.Schema.Type<typeof ImageFormat>

export const ImageBlock = Schema.Struct({
  image: Schema.Struct({
    format: ImageFormat,
    source: Schema.Struct({ bytes: Schema.String }),
  }),
})
export type ImageBlock = Schema.Schema.Type<typeof ImageBlock>

// Bedrock document blocks require a user-facing name so the model can refer to
// the uploaded document.
export const DocumentFormat = Schema.Literals(["pdf", "csv", "doc", "docx", "xls", "xlsx", "html", "txt", "md"])
export type DocumentFormat = Schema.Schema.Type<typeof DocumentFormat>

export const DocumentBlock = Schema.Struct({
  document: Schema.Struct({
    format: DocumentFormat,
    name: Schema.String,
    source: Schema.Struct({ bytes: Schema.String }),
  }),
})
export type DocumentBlock = Schema.Schema.Type<typeof DocumentBlock>

const IMAGE_FORMATS = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const satisfies Record<string, ImageFormat>

const DOCUMENT_FORMATS = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "text/plain": "txt",
  "text/markdown": "md",
} as const satisfies Record<string, DocumentFormat>

const imageBlock = (part: MediaPart, format: ImageFormat): ImageBlock => ({
  image: { format, source: { bytes: ProviderShared.mediaBytes(part) } },
})

const documentBlock = (part: MediaPart, format: DocumentFormat): DocumentBlock => ({
  document: {
    format,
    name: part.filename ?? `document.${format}`,
    source: { bytes: ProviderShared.mediaBytes(part) },
  },
})

// Route by MIME. Known image/document formats lower into a typed block; anything
// else fails with a clear error instead of silently degrading to a malformed
// document block. Image MIME types not in `IMAGE_FORMATS` (e.g. `image/svg+xml`)
// get an image-specific error so the caller knows it's a format-support issue,
// not a kind-detection issue.
export const lower = (part: MediaPart) => {
  const mime = part.mediaType.toLowerCase()
  const imageFormat = IMAGE_FORMATS[mime as keyof typeof IMAGE_FORMATS]
  if (imageFormat) return Effect.succeed(imageBlock(part, imageFormat))
  if (mime.startsWith("image/"))
    return ProviderShared.invalidRequest(`Bedrock Converse does not support image media type ${part.mediaType}`)
  const documentFormat = DOCUMENT_FORMATS[mime as keyof typeof DOCUMENT_FORMATS]
  if (documentFormat) return Effect.succeed(documentBlock(part, documentFormat))
  return ProviderShared.invalidRequest(`Bedrock Converse does not support media type ${part.mediaType}`)
}

export * as BedrockMedia from "./bedrock-media"
