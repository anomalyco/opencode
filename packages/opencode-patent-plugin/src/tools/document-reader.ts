/**
 * 文档读取工具
 *
 * 支持 DOCX/DOC/WPS、PDF（含 OCR）、图片、TXT/MD 格式。
 * 用于读取技术交底书、对比文件等专利业务文档。
 */

import { tool } from "@yunpat/plugin/tool"
import * as fs from "fs"
import * as path from "path"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { detectAndParse } from "../utils/document-parser.js"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export async function registerDocumentReaderTools(_pluginContext: PatentPluginContext) {
  return {
    document_read: tool({
      description: `
        读取文档文件内容。支持专利业务中常见的文档格式。

        支持的格式：
        - DOCX/DOC/WPS: 技术交底书、申请文件
        - PDF: 对比文件、审查意见通知书（扫描件可启用 OCR）
        - PNG/JPG/BMP/TIFF: 图片 OCR 识别
        - TXT/MD: 纯文本文件

        使用场景：
        - 读取技术交底书（Word 文档）提取发明内容
        - 读取对比文件（PDF）获取现有技术描述
        - OCR 识别扫描版对比文件或审查通知书
      `,
      args: {
        filePath: tool.schema.string().describe(
          "文件路径（绝对路径或相对于工作目录的路径）",
        ),
        outputFormat: tool.schema
          .enum(["text", "markdown", "structured"])
          .optional()
          .describe("输出格式：text=纯文本, markdown=Markdown（默认）, structured=含元数据的 JSON"),
        ocr: tool.schema
          .boolean()
          .optional()
          .describe("是否启用 OCR（用于扫描版 PDF 或图片，默认 false）"),
        ocrLanguages: tool.schema
          .string()
          .optional()
          .describe("OCR 语言，逗号分隔，如 'eng,chi_sim'（默认 eng+chi_sim）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "document",
          patterns: ["read"],
          always: [],
          metadata: { action: "read", filePath: args.filePath },
        })

        const { filePath, outputFormat = "markdown", ocr = false, ocrLanguages } = args

        // 解析路径
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(ctx.worktree || ctx.directory, filePath)

        // 路径遍历保护：确保解析后的路径不超出工作目录范围
        const normalizedPath = path.normalize(resolvedPath)
        const basePath = path.normalize(ctx.worktree || ctx.directory)
        if (!normalizedPath.startsWith(basePath)) {
          return `❌ 文件路径超出工作目录范围`
        }

        // 验证文件存在
        if (!fs.existsSync(resolvedPath)) {
          return `❌ 文件不存在: ${resolvedPath}\n\n请检查文件路径是否正确。`
        }

        const stats = fs.statSync(resolvedPath)
        if (stats.size > MAX_FILE_SIZE) {
          return `❌ 文件过大（${(stats.size / 1024 / 1024).toFixed(1)}MB），当前限制 50MB。`
        }

        try {
          const languages = ocrLanguages ? ocrLanguages.split(",").map(s => s.trim()) : undefined
          const result = await detectAndParse(resolvedPath, { ocr, ocrLanguages: languages })

          ctx.metadata({
            title: `文档读取: ${result.metadata.filename}`,
            metadata: {
              format: result.metadata.format,
              size: result.metadata.size,
              pages: result.metadata.pages,
              parseTime: result.metadata.parseTime,
            },
          })

          if (outputFormat === "structured") {
            return JSON.stringify(result, null, 2)
          }

          // text 或 markdown 格式
          let output = result.text

          // 扫描件提示
          if (result.metadata.needsOcr && !ocr) {
            output += `\n\n---\n⚠️ 此 PDF 可能是扫描件（${result.metadata.pages} 页，提取文本极少）。建议设置 ocr=true 启用 OCR 识别。`
          }

          return output
        } catch (error: any) {
          return `❌ 文档解析失败: ${error?.message || error}\n\n支持的格式: DOCX/DOC/WPS、PDF、PNG/JPG/BMP/TIFF、TXT/MD`
        }
      },
    }),
  }
}
