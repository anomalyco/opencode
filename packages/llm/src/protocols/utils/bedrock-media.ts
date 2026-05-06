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

const lowerImage = (part: MediaPart, mime: string) => {
  const format = IMAGE_FORMATS[mime as keyof typeof IMAGE_FORMATS]
  if (!format) return ProviderShared.invalidRequest(`Bedrock Converse does not support image media type ${part.mediaType}`)
  return Effect.succeed<ImageBlock>({
    image: { format, source: { bytes: ProviderShared.mediaBytes(part) } },
  })
}

const lowerDocument = (part: MediaPart, mime: string) => {
  const format = DOCUMENT_FORMATS[mime as keyof typeof DOCUMENT_FORMATS]
  if (!format) return ProviderShared.invalidRequest(`Bedrock Converse does not support document media type ${part.mediaType}`)
  return Effect.succeed<DocumentBlock>({
    document: {
      format,
      name: part.filename ?? `document.${format}`,
      source: { bytes: ProviderShared.mediaBytes(part) },
    },
  })
}

export const lower = (part: MediaPart) => {
  const mime = part.mediaType.toLowerCase()
  return mime.startsWith("image/") ? lowerImage(part, mime) : lowerDocument(part, mime)
}

export * as BedrockMedia from "./bedrock-media"
