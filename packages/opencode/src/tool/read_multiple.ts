import z from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import { InstructionPrompt } from "../session/instruction"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000 // 与 ReadTool 保持一致
const MAX_BYTES_PER_FILE = 50 * 1024 // 50KB per file
const MAX_TOTAL_BYTES = 512 * 1024 // 512KB total for the whole tool call
const CONCURRENCY_LIMIT = 5 // 并发读取限制

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FileReadResult {
  filePath: string
  title: string
  content: string
  truncated: boolean
  error?: string
  size: number
  sizeHuman: string
}

async function readSingleFile(
  ctx: Tool.Context,
  filePath: string,
  offset: number = 0,
  limit: number = DEFAULT_READ_LIMIT,
): Promise<FileReadResult> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(Instance.directory, filePath)
  const title = path.relative(Instance.worktree, absolutePath)

  const file = Bun.file(absolutePath)
  if (!(await file.exists())) {
    return {
      filePath,
      title,
      content: "",
      truncated: false,
      error: `File not found: ${absolutePath}`,
      size: 0,
      sizeHuman: "0 B",
    }
  }

  const instructions = await InstructionPrompt.resolve(ctx.messages, absolutePath, ctx.messageID)

  const stat = await file.stat()
  const fileSize = stat.size

  const isBinary = await isBinaryFile(absolutePath, fileSize, file)
  if (isBinary) {
    return {
      filePath,
      title,
      content: "",
      truncated: false,
      error: `Cannot read binary file: ${absolutePath}`,
      size: fileSize,
      sizeHuman: formatSize(fileSize),
    }
  }

  const raw: string[] = []
  let bytesRead = 0
  let truncatedByBytes = false
  let lineIndex = 0
  let hasMoreLines = false

  const stream = file.stream()
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        buffer += decoder.decode()
        const lines = buffer ? buffer.split(/\r?\n/) : []
        for (const line of lines) {
          if (lineIndex >= offset && lineIndex < offset + limit) {
            const processedLine = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
            const size = Buffer.byteLength(processedLine, "utf-8") + (raw.length > 0 ? 1 : 0)
            if (bytesRead + size > MAX_BYTES_PER_FILE) {
              truncatedByBytes = true
              break
            }
            raw.push(processedLine)
            bytesRead += size
          } else if (lineIndex >= offset + limit) {
            hasMoreLines = true
            break
          }
          lineIndex++
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ""

      let stop = false
      for (const line of lines) {
        if (lineIndex >= offset && lineIndex < offset + limit) {
          const processedLine = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
          const size = Buffer.byteLength(processedLine, "utf-8") + (raw.length > 0 ? 1 : 0)
          if (bytesRead + size > MAX_BYTES_PER_FILE) {
            truncatedByBytes = true
            stop = true
            break
          }
          raw.push(processedLine)
          bytesRead += size
        } else if (lineIndex >= offset + limit) {
          hasMoreLines = true
          stop = true
          break
        }
        lineIndex++
      }

      if (stop) {
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }

  const content = raw.map((line, index) => {
    return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
  })

  let output = `<file path="${title}" size="${formatSize(fileSize)}">\n`
  output += content.join("\n")

  const lastReadLine = offset + raw.length
  const truncated = hasMoreLines || truncatedByBytes

  if (truncatedByBytes) {
    output += `\n\n(Output truncated at ${formatSize(MAX_BYTES_PER_FILE)}. Use 'offset' parameter to read beyond line ${lastReadLine})`
  } else if (hasMoreLines) {
    output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
  } else {
    const totalLines = lineIndex + (buffer ? 1 : 0)
    output += `\n\n(End of file - total ${totalLines} lines)`
  }

  if (instructions.length > 0) {
    output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
  }

  output += "\n</file>"

  LSP.touchFile(absolutePath, false)
  FileTime.read(ctx.sessionID, absolutePath)

  return {
    filePath,
    title,
    content: output,
    truncated,
    size: fileSize,
    sizeHuman: formatSize(fileSize),
  }
}

async function isBinaryFile(filepath: string, fileSize: number, file: Bun.BunFile): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
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

  if (fileSize === 0) return false

  const bufferSize = Math.min(4096, fileSize)
  const buffer = await file.slice(0, bufferSize).arrayBuffer()
  if (buffer.byteLength === 0) return false
  const bytes = new Uint8Array(buffer)

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  return nonPrintableCount / bytes.length > 0.3
}

const FileParams = z.object({
  filePath: z.string().describe("The path to the file to read"),
  offset: z.coerce.number().int().nonnegative().default(0).describe("The line number to start reading from (0-based)"),
  limit: z.coerce.number().int().positive().default(DEFAULT_READ_LIMIT).describe("The number of lines to read"),
})

export const ReadMultipleTool = Tool.define("read_multiple", {
  description: `CRITICAL: ALWAYS USE THIS TOOL when reading 2 or more files. Using the 'read' tool for multiple files is FORBIDDEN and inefficient.

This tool is specifically designed for high-performance, parallel reading of multiple files, providing a unified context that is easier to process.`,
  parameters: z.object({
    files: z
      .array(FileParams)
      .min(1)
      .max(50)
      .describe("Array of files to read. Each file can have optional offset and limit parameters."),
  }),
  async execute(params, ctx) {
    const allPaths = params.files.map((f) => f.filePath)

    // Pre-validate all paths and ensure they are absolute
    const absolutePaths = allPaths.map((fp) => {
      let abs = fp
      if (!path.isAbsolute(abs)) {
        abs = path.resolve(Instance.directory, abs)
      }
      return abs
    })

    // Check external directory for all paths
    for (const abs of absolutePaths) {
      await assertExternalDirectory(ctx, abs, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
      })
    }

    // Single permission request for all files
    await ctx.ask({
      permission: "read",
      patterns: absolutePaths,
      always: ["*"],
      metadata: {},
    })

    // Read files with concurrency control
    const results: FileReadResult[] = []
    for (let i = 0; i < params.files.length; i += CONCURRENCY_LIMIT) {
      const chunk = params.files.slice(i, i + CONCURRENCY_LIMIT)
      const chunkResults = await Promise.all(chunk.map((f) => readSingleFile(ctx, f.filePath, f.offset, f.limit)))
      results.push(...chunkResults)
    }

    const errors = results.filter((r) => r.error)
    const successes = results.filter((r) => !r.error)

    let totalOutputBytes = 0
    const outputParts: string[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      let part = ""

      if (result.error) {
        part += `### ${result.title}\n`
        part += `> [!CAUTION]\n> ${result.error}\n\n`
      } else {
        part += result.content + "\n\n"
      }

      const partSize = Buffer.byteLength(part, "utf-8")
      if (totalOutputBytes + partSize > MAX_TOTAL_BYTES) {
        outputParts.push(`\n(Total output limit reached. Skipping remaining ${results.length - i} files...)\n`)
        break
      }

      outputParts.push(part)
      totalOutputBytes += partSize
    }

    const output = outputParts.join("")
    const preview = successes
      .slice(0, 3)
      .map((r) => r.title)
      .join(", ")

    return {
      title: `${results.length} file${results.length > 1 ? "s" : ""}`,
      output,
      metadata: {
        preview,
        count: results.length, // 添加 count 字段以供 UI 显示
        total: results.length, // 兼容 glob 模式的 total 字段
        totalFiles: results.length,
        successfulFiles: successes.length,
        failedFiles: errors.length,
        totalBytes: totalOutputBytes,
        truncated: totalOutputBytes >= MAX_TOTAL_BYTES, // Set this to prevent double truncation if we already handled it
        files: results.map((r) => ({
          path: r.filePath,
          title: r.title,
          truncated: r.truncated,
          error: r.error,
          size: r.sizeHuman,
        })),
      },
    }
  },
})
