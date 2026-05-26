import { Effect, Schema } from "effect"
import { PatentDocument } from "@/patent/document"
import { PatentDrawing } from "@/patent/drawing"
import * as Tool from "./tool"

const ConvertParams = Schema.Struct({
  action: Schema.Literal("convert"),
  filePath: Schema.String.annotate({ description: "The file path to convert" }),
  outputFormat: Schema
    .optional(Schema.Union([Schema.Literal("markdown"), Schema.Literal("text"), Schema.Literal("structured")]))
    .annotate({ description: "Output format: markdown/text/structured (default: markdown)" }),
  ocr: Schema.optional(Schema.Boolean).annotate({ description: "Enable OCR for image/PDF files" }),
})

const AnalyzeDrawingParams = Schema.Struct({
  action: Schema.Literal("analyze_drawing"),
  image: Schema.String.annotate({ description: "The image file path to analyze" }),
  drawingContext: Schema.optional(Schema.String).annotate({ description: "Optional context about the drawing" }),
})

const BatchConvertParams = Schema.Struct({
  action: Schema.Literal("batch_convert"),
  filePaths: Schema.Array(Schema.String).annotate({ description: "Array of file paths to convert" }),
  outputFormat: Schema
    .optional(Schema.Union([Schema.Literal("markdown"), Schema.Literal("text"), Schema.Literal("structured")]))
    .annotate({ description: "Output format: markdown/text/structured (default: markdown)" }),
  ocr: Schema.optional(Schema.Boolean).annotate({ description: "Enable OCR for image/PDF files" }),
})

export const Parameters = Schema.Union([ConvertParams, AnalyzeDrawingParams, BatchConvertParams])

type ConvertMetadata = {
  format?: string
  count?: number
}

export const PatentConvertTool = Tool.define(
  "patent_convert",
  Effect.gen(function* () {
    const docService = yield* PatentDocument.Service
    const drawingService = yield* PatentDrawing.Service

    return {
      description: "文档格式转换与技术图纸识别。支持 DOCX/PDF/图片转 Markdown，以及技术图纸的多模态分析。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "convert") {
            const result = yield* docService.convertToMarkdown(params.filePath, { ocr: params.ocr })
            const metadata: ConvertMetadata = { format: result.format }
            return {
              title: params.filePath,
              output: result.text,
              metadata,
            }
          }

          if (params.action === "analyze_drawing") {
            const buffer = yield* Effect.tryPromise({
              try: () => Bun.file(params.image).arrayBuffer(),
              catch: (cause) => new Error(`Failed to read image file: ${params.image}`, { cause }),
            })
            const result = yield* drawingService.analyzeDrawing(Buffer.from(buffer), params.drawingContext)
            const output = [
              `图纸描述: ${result.description}`,
              `识别要素: ${result.elements.join(", ")}`,
            ].join("\n")
            const metadata: ConvertMetadata = {}
            return {
              title: params.image,
              output,
              metadata,
            }
          }

          if (params.action === "batch_convert") {
            const results = yield* Effect.all(
              params.filePaths.map((filePath: string) =>
                docService.convertToMarkdown(filePath, { ocr: params.ocr }).pipe(
                  Effect.map((result) => ({ filePath, text: result.text, format: result.format })),
                ),
              ),
              { concurrency: 5 },
            )
            const output = results.map((r: { filePath: string; text: string; format: string }) => `## ${r.filePath}\n\n${r.text}`).join("\n\n---\n\n")
            const metadata: ConvertMetadata = { count: results.length }
            return {
              title: `批量转换: ${results.length} 个文件`,
              output,
              metadata,
            }
          }

          const metadata: ConvertMetadata = {}
          return {
            title: "Unknown action",
            output: "Invalid action",
            metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)