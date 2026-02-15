import z from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./law_read.txt"
import { Instance } from "../project/instance"

const DEFAULT_READ_LIMIT = 2000

export const LawReadTool = Tool.define("law_read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("案卷或法律文书的绝对路径"),
    offset: z.coerce.number().describe("起始行号（从1开始）").optional(),
    limit: z.coerce.number().describe("最大读取行数（默认2000行）").optional(),
  }),
  async execute(params, ctx) {
    if (params.offset !== undefined && params.offset < 1) {
      throw new Error("offset 必须大于等于 1")
    }

    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    const title = path.relative(Instance.worktree, filepath)
    const file = Bun.file(filepath)
    const stat = await file.stat().catch(() => undefined)

    if (!stat) {
      throw new Error(`文件不存在: ${filepath}`)
    }

    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    // 支持读取目录（案卷目录）
    if (stat.isDirectory()) {
      const dirents = await fs.promises.readdir(filepath, { withFileTypes: true })
      const entries = await Promise.all(
        dirents.map(async (dirent) => {
          if (dirent.isDirectory()) return dirent.name + "/"
          if (dirent.isSymbolicLink()) {
            const target = await fs.promises.stat(path.join(filepath, dirent.name)).catch(() => undefined)
            if (target?.isDirectory()) return dirent.name + "/"
          }
          return dirent.name
        }),
      )
      entries.sort((a, b) => a.localeCompare(b))

      const limit = params.limit ?? DEFAULT_READ_LIMIT
      const offset = params.offset ?? 1
      const start = offset - 1
      const sliced = entries.slice(start, start + limit)
      const truncated = start + sliced.length < entries.length

      const output = [
        `<案卷路径>${filepath}</案卷路径>`,
        `<类型>目录</类型>`,
        `<文件列表>`,
        sliced.join("\n"),
        truncated
          ? `\n(显示 ${sliced.length}/${entries.length} 个文件。使用 offset 参数继续读取)`
          : `\n(共 ${entries.length} 个文件)`,
        `</文件列表>`,
      ].join("\n")

      return {
        title,
        output,
        metadata: {
          preview: sliced.slice(0, 20).join("\n"),
          truncated,
        },
      }
    }

    // 检查是否为图片或PDF
    const isImage =
      file.type.startsWith("image/") && file.type !== "image/svg+xml"
    const isPdf = file.type === "application/pdf"

    if (isImage || isPdf) {
      const msg = `${isImage ? "图片" : "PDF"}已读取: ${filepath}`
      return {
        title,
        output: msg,
        metadata: {
          preview: msg,
          truncated: false,
        },
        attachments: [
          {
            id: `law_read_${Date.now()}`,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime: file.type,
            url: `data:${file.type};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
          },
        ],
      }
    }

    // 读取文本文件
    const text = await file.text()
    if (!text) {
      return {
        title,
        output: `文件为空: ${filepath}`,
        metadata: { preview: "", truncated: false },
      }
    }

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset ?? 1
    const start = offset - 1
    const lines = text.split("\n")

    if (start >= lines.length) {
      throw new Error(`偏移量 ${offset} 超出文件范围（共 ${lines.length} 行）`)
    }

    const content = lines.slice(start, start + limit)
    const truncated = start + content.length < lines.length

    const formattedContent = content.map((line, index) => {
      return `${index + offset}: ${line}`
    }).join("\n")

    const output = [
      `<案卷路径>${filepath}</案卷路径>`,
      `<类型>文件</类型>`,
      `<内容>`,
      formattedContent,
      truncated
        ? `\n(文件共 ${lines.length} 行。使用 offset 参数继续读取)`
        : `\n(文件结束，共 ${lines.length} 行)`,
      `</内容>`,
    ].join("\n")

    return {
      title,
      output,
      metadata: {
        preview: content.slice(0, 20).join("\n"),
        truncated,
      },
    }
  },
})
