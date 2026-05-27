/**
 * 文件输出工具
 *
 * 将工具产出（撰写稿、答辩书、分析报告等）保存到工作目录文件中。
 */

import { tool } from "@yunpat/plugin/tool"
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { getCaseStore, type DocType } from "../utils/case-store.js"

export async function registerFileWriterTools(_pluginContext: PatentPluginContext) {
  return {
    file_write: tool({
      description: `
        将内容保存为文件。用于持久化工具产出（撰写稿、答辩书、分析报告等）。

        使用场景：
        - 保存专利撰写稿到文件
        - 保存审查意见答辩书
        - 保存分析报告
        - 导出检索结果

        文件路径相对于当前工作目录。如需指定子目录，会自动创建。
      `,
      args: {
        content: tool.schema.string().describe("文件内容"),
        filePath: tool.schema.string().describe("保存路径（相对于工作目录，如 output/draft.md）"),
        overwrite: tool.schema
          .boolean()
          .optional()
          .describe("是否覆盖已有文件（默认 false，已有文件时自动递增序号）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "file",
          patterns: ["write"],
          always: [],
          metadata: { action: "write", filePath: args.filePath },
        })

        const { content, filePath, overwrite = false } = args

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

        // 检查文件是否已存在
        if (fs.existsSync(resolvedPath) && !overwrite) {
          const ext = path.extname(resolvedPath)
          const base = resolvedPath.slice(0, -ext.length || resolvedPath.length)
          let counter = 1
          let newPath = `${base}_${counter}${ext}`
          while (fs.existsSync(newPath)) {
            counter++
            newPath = `${base}_${counter}${ext}`
          }
          // 使用递增路径
          const finalPath = newPath
          const dir = path.dirname(finalPath)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
          fs.writeFileSync(finalPath, content, "utf-8")
          const relativePath = path.relative(ctx.worktree || ctx.directory, finalPath)

          // 记录文档版本
          try {
            const store = getCaseStore()
            const caseRecord = store.getOrCreateCaseForProject(ctx.directory)
            const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16)
            store.addDocument({
              caseId: caseRecord.id,
              docType: guessDocType(relativePath),
              filePath: relativePath,
              contentHash,
            })
          } catch {}

          return `✅ 文件已保存: ${relativePath}\n（原文件已存在，自动递增序号）`
        }

        // 写入文件
        const dir = path.dirname(resolvedPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(resolvedPath, content, "utf-8")

        const relativePath = path.relative(ctx.worktree || ctx.directory, resolvedPath)

        // 记录文档版本到案件存储
        try {
          const store = getCaseStore()
          const caseRecord = store.getOrCreateCaseForProject(ctx.directory)
          const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16)
          const docType = guessDocType(relativePath)
          store.addDocument({
            caseId: caseRecord.id,
            docType,
            filePath: relativePath,
            contentHash,
          })
        } catch {
          // 文档记录失败不影响文件写入
        }

        return `✅ 文件已保存: ${relativePath}`
      },
    }),
  }
}

/** 根据文件路径猜测文档类型 */
function guessDocType(filePath: string): DocType {
  const lower = filePath.toLowerCase()
  if (lower.includes("spec") || lower.includes("说明书")) return "specification"
  if (lower.includes("claim") || lower.includes("权利要求")) return "claims"
  if (lower.includes("abstract") || lower.includes("摘要")) return "abstract"
  if (lower.includes("response") || lower.includes("答辩") || lower.includes("陈述")) return "response"
  if (lower.includes("oa") || lower.includes("审查意见")) return "office_action"
  if (lower.includes("reexam") || lower.includes("复审")) return "reexam_request"
  if (lower.includes("invalidation") || lower.includes("无效")) return "invalidation_req"
  if (lower.includes("search") || lower.includes("检索")) return "search_report"
  if (lower.includes("analysis") || lower.includes("分析")) return "analysis_report"
  if (lower.includes("disclosure") || lower.includes("交底")) return "disclosure"
  return "other"
}
