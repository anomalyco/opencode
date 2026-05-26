import { Context, Effect, Layer, Schema } from "effect"

class UnsupportedFormatError extends Schema.TaggedErrorClass<UnsupportedFormatError>()("UnsupportedFormatError", {
  message: Schema.String,
}) {}

class ConversionError extends Schema.TaggedErrorClass<ConversionError>()("ConversionError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export interface Interface {
  readonly convertToMarkdown: (
    filePath: string,
    opts?: { ocr?: boolean },
  ) => Effect.Effect<{ text: string; format: string }, UnsupportedFormatError | ConversionError>
  readonly supportedFormats: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentDocument") {}

const supportedFormatsList = [".txt", ".md", ".docx", ".pdf", ".png", ".jpg", ".jpeg"]

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const supportedFormats = Effect.fn("PatentDocument.supportedFormats")(function* () {
      return supportedFormatsList
    })

    const convertToMarkdown = Effect.fn("PatentDocument.convertToMarkdown")(
      function* (filePath: string, opts?: { ocr?: boolean }) {
        const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."))

        if (!supportedFormatsList.includes(ext)) {
          return yield* new UnsupportedFormatError({ message: `Unsupported file format: ${ext}` })
        }

        if (ext === ".txt" || ext === ".md") {
          const text = yield* Effect.tryPromise({
            try: () => Bun.file(filePath).text(),
            catch: (cause) => new ConversionError({ message: `Failed to read file: ${filePath}`, cause }),
          })
          return { text, format: ext === ".txt" ? "plain" : "markdown" }
        }

        if (ext === ".docx") {
          const mammoth = yield* Effect.tryPromise({
            try: () => import("mammoth"),
            catch: (cause) => new ConversionError({ message: "mammoth package not installed", cause }),
          })
          const turndown = yield* Effect.tryPromise({
            try: () => import("turndown"),
            catch: (cause) => new ConversionError({ message: "turndown package not installed", cause }),
          })
          const buffer = yield* Effect.tryPromise({
            try: () => Bun.file(filePath).arrayBuffer(),
            catch: (cause) => new ConversionError({ message: `Failed to read file: ${filePath}`, cause }),
          })
          const html = yield* Effect.tryPromise({
            try: () => mammoth.convertToHtml({ arrayBuffer: buffer }),
            catch: (cause) => new ConversionError({ message: "Failed to convert docx to html", cause }),
          })
          const turndownService = new turndown.default()
          const text = turndownService.turndown((html as { value: string }).value)
          return { text, format: "markdown" }
        }

        if (ext === ".pdf") {
          const pdfParse = yield* Effect.tryPromise({
            try: () => import("pdf-parse"),
            catch: (cause) => new ConversionError({ message: "pdf-parse package not installed", cause }),
          })
          const buffer = yield* Effect.tryPromise({
            try: () => Bun.file(filePath).arrayBuffer(),
            catch: (cause) => new ConversionError({ message: `Failed to read file: ${filePath}`, cause }),
          })
          const data = yield* Effect.tryPromise({
            try: () => pdfParse.default(Buffer.from(buffer)),
            catch: (cause) => new ConversionError({ message: "Failed to parse pdf", cause }),
          })
          return { text: (data as { text: string }).text, format: "plain" }
        }

        if ([".png", ".jpg", ".jpeg"].includes(ext)) {
          if (opts?.ocr) {
            return {
              text: "[OCR not yet implemented for image files]",
              format: "plain",
            }
          }
          return {
            text: "[Image file - use OCR option to extract text]",
            format: "image",
          }
        }

        return yield* new UnsupportedFormatError({ message: `Unsupported file format: ${ext}` })
      },
    )

    return Service.of({ convertToMarkdown, supportedFormats })
  }),
)

export const defaultLayer = layer

export * as PatentDocument from "./document"