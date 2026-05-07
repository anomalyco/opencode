/**
 * 文件输出工具
 *
 * 将工具产出（撰写稿、答辩书、分析报告等）保存到工作目录文件中。
 */

import { tool } from "@opencode-ai/plugin/tool"
import * as fs from "fs"
import * as path from "path"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"

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
          return `✅ 文件已保存: ${relativePath}\n（原文件已存在，自动递增序号）`
        }

        // 写入文件
        const dir = path.dirname(resolvedPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(resolvedPath, content, "utf-8")

        const relativePath = path.relative(ctx.worktree || ctx.directory, resolvedPath)
        return `✅ 文件已保存: ${relativePath}`
      },
    }),
  }
}
