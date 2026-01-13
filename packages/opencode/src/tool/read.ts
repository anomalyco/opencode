/**
 * ============================================================================
 * 文件名：read.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Read 工具模块。允许 AI 读取文件内容。
 *
 * 主要功能：
 * - ReadTool：读取文件的工具
 * - 支持分页读取（offset/limit）
 * - 检测二进制文件
 * - 支持图片和 PDF（作为附件）
 * - 提供文件名建议
 *
 * 依赖关系：
 * - zod：类型验证
 * - fs：文件系统（同步）
 * - path：路径处理
 * - ./tool：工具基类
 * - ../lsp：LSP 集成
 * - ../file/time：文件时间跟踪
 * - ./read.txt：工具描述模板
 * - ../project/instance：实例管理
 * - ../id/id：标识符生成
 * - ./external-directory：外部目录检查
 *
 * 导出内容：
 * - ReadTool：读取工具定义
 * - isBinaryFile()：二进制文件检测
 *
 * 参数：
 * - filePath：文件路径
 * - offset：起始行号（0-based，可选）
 * - limit：读取行数（默认 2000）
 *
 * 返回：
 * - title：相对路径标题
 * - output：文件内容（带行号）
 * - attachments：图片/PDF 的 base64 附件
 * - metadata：元数据（预览、是否截断）
 *
 * 常量：
 * - DEFAULT_READ_LIMIT：默认读取 2000 行
 * - MAX_LINE_LENGTH：单行最大 2000 字符
 * - MAX_BYTES：最大 50KB
 *
 * 二进制检测：
 * - 文件扩展名检查
 * - 内容字节分析
 * - 空字节检测
 * - 不可打印字符比例
 *
 * 输出格式：
 * - 带行号的内容（5 位对齐）
 * - 截断提示
 * - 文件结束标记
 *
 * @package opencode
 * @module tool/read
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入文件系统（同步）
import * as fs from "fs"

// 导入路径处理
import * as path from "path"

// 导入工具基类
import { Tool } from "./tool"

// 导入 LSP 集成
import { LSP } from "../lsp"

// 导入文件时间跟踪
import { FileTime } from "../file/time"

// 导入工具描述模板
import DESCRIPTION from "./read.txt"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入标识符生成
import { Identifier } from "../id/id"

// 导入外部目录检查
import { assertExternalDirectory } from "./external-directory"

// 默认读取行数限制
const DEFAULT_READ_LIMIT = 2000

// 单行最大长度
const MAX_LINE_LENGTH = 2000

// 最大字节数（50KB）
const MAX_BYTES = 50 * 1024

/**
 * 读取工具定义
 *
 * 允许 AI 读取文件内容。
 */
export const ReadTool = Tool.define("read", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 文件路径
    filePath: z.string().describe("The path to the file to read"),
    // 起始行号（0-based）
    offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
    // 读取行数
    limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
  }),

  async execute(params, ctx) {
    let filepath = params.filePath

    // 转换为绝对路径
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(process.cwd(), filepath)
    }

    // 使用相对路径作为标题
    const title = path.relative(Instance.worktree, filepath)

    // 检查外部目录权限
    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
    })

    // 请求 read 权限
    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    // 获取文件
    const file = Bun.file(filepath)

    // 文件不存在
    if (!(await file.exists())) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      // 读取目录条目以提供建议
      const dirEntries = fs.readdirSync(dir)
      const suggestions = dirEntries
        .filter(
          (entry) =>
            entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
        )
        .map((entry) => path.join(dir, entry))
        .slice(0, 3)

      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
      }

      throw new Error(`File not found: ${filepath}`)
    }

    // 处理图片文件
    const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml"
    const isPdf = file.type === "application/pdf"

    if (isImage || isPdf) {
      const mime = file.type
      const msg = `${isImage ? "Image" : "PDF"} read successfully`

      return {
        title,
        output: msg,
        metadata: {
          preview: msg,
          truncated: false,
        },
        // 作为附件返回
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime,
            // base64 编码
            url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
          },
        ],
      }
    }

    // 检查二进制文件
    const isBinary = await isBinaryFile(filepath, file)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    // 读取限制
    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 0

    // 分割为行
    const lines = await file.text().then((text) => text.split("\n"))

    // 读取指定范围的行
    const raw: string[] = []
    let bytes = 0
    let truncatedByBytes = false

    for (let i = offset; i < Math.min(lines.length, offset + limit); i++) {
      // 截断过长的行
      const line = lines[i].length > MAX_LINE_LENGTH ? lines[i].substring(0, MAX_LINE_LENGTH) + "..." : lines[i]

      // 计算字节数（包括换行符）
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)

      // 检查字节限制
      if (bytes + size > MAX_BYTES) {
        truncatedByBytes = true
        break
      }

      raw.push(line)
      bytes += size
    }

    // 格式化输出（带行号）
    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
    })

    // 预览（前 20 行）
    const preview = raw.slice(0, 20).join("\n")

    // 构建输出
    let output = "<file>\n"
    output += content.join("\n")

    // 计算行数信息
    const totalLines = lines.length
    const lastReadLine = offset + raw.length
    const hasMoreLines = totalLines > lastReadLine
    const truncated = hasMoreLines || truncatedByBytes

    // 添加截断提示
    if (truncatedByBytes) {
      output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else {
      output += `\n\n(End of file - total ${totalLines} lines)`
    }
    output += "\n</file>"

    // 触发 LSP（懒加载）
    LSP.touchFile(filepath, false)

    // 记录读取时间
    FileTime.read(ctx.sessionID, filepath)

    return {
      title,
      output,
      metadata: {
        preview,
        truncated,
      },
    }
  },
})

/**
 * 检测是否为二进制文件
 *
 * 通过文件扩展名和内容分析判断。
 *
 * @param filepath - 文件路径
 * @param file - Bun 文件对象
 * @returns Promise，解析为是否为二进制文件
 *
 * 检测方法：
 * 1. 检查已知的二进制文件扩展名
 * 2. 检查空字节（0x00）
 * 3. 检查不可打印字符比例
 * 4. 如果超过 30% 不可打印，则认为是二进制
 */
async function isBinaryFile(filepath: string, file: Bun.BunFile): Promise<boolean> {
  // 获取文件扩展名
  const ext = path.extname(filepath).toLowerCase()

  // 常见二进制文件扩展名检查
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
    default:
      break
  }

  // 获取文件大小
  const stat = await file.stat()
  const fileSize = stat.size
  if (fileSize === 0) return false

  // 读取文件头部
  const bufferSize = Math.min(4096, fileSize)
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength === 0) return false

  const bytes = new Uint8Array(buffer.slice(0, bufferSize))

  // 检查空字节
  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    // 空字节直接返回 true
    if (bytes[i] === 0) return true

    // 计数不可打印字符
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }

  // 如果超过 30% 不可打印字符，认为是二进制
  return nonPrintableCount / bytes.length > 0.3
}
