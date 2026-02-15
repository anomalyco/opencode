import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./law_write.txt"
import { Instance } from "../project/instance"
import * as fs from "fs"

export const LawWriteTool = Tool.define("law_write", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("法律文书的保存路径"),
    content: z.string().describe("法律文书内容"),
    documentType: z.string().describe("文书类型（如：起诉书、审查报告、不起诉决定书等）").optional(),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    const title = path.relative(Instance.worktree, filepath)

    await ctx.ask({
      permission: "write",
      patterns: [filepath],
      always: ["*"],
      metadata: {
        documentType: params.documentType,
      },
    })

    // 确保目录存在
    const dir = path.dirname(filepath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // 写入文件
    await fs.promises.writeFile(filepath, params.content, "utf-8")

    const lines = params.content.split("\n").length
    const bytes = Buffer.byteLength(params.content, "utf-8")

    const output = [
      `<文书生成成功>`,
      `<路径>${filepath}</路径>`,
      `<文书类型>${params.documentType || "未指定"}</文书类型>`,
      `<统计>`,
      `- 行数: ${lines}`,
      `- 字节数: ${bytes}`,
      `</统计>`,
      `</文书生成成功>`,
    ].join("\n")

    return {
      title,
      output,
      metadata: {
        filePath: filepath,
        documentType: params.documentType,
        lines,
        bytes,
      },
    }
  },
})
