import z from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { InstructionPrompt } from "../session/instruction"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_BYTES = 50 * 1024

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The path to the file to read"),
    offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
    limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }
    const title = path.relative(Instance.worktree, filepath)

    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
    })

    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      const dirEntries = await fs.promises.readdir(dir).catch(() => [])
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

    const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)

    const stat = await file.stat()
    const fileSize = stat.size

    const isImage =
      file.type.startsWith("image/") && file.type !== "image/svg+xml" && file.type !== "image/vnd.fastbidsheet"
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
          size: fileSize,
          sizeHuman: formatSize(fileSize),
          ...(instructions.length > 0 && { loaded: instructions.map((i) => i.filepath) }),
        },
        attachments: [
          {
            type: "file",
            mime,
            url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
          },
        ],
      }
    }

    const isBinary = await isBinaryFile(filepath, fileSize, file)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 0

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
          if (buffer) {
            const lines = buffer.split(/\r?\n/)
            for (const line of lines) {
              if (lineIndex >= offset && lineIndex < offset + limit) {
                const processedLine = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
                const size = Buffer.byteLength(processedLine, "utf-8") + (raw.length > 0 ? 1 : 0)
                if (bytesRead + size > MAX_BYTES) {
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
            if (bytesRead + size > MAX_BYTES) {
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
    const preview = raw.slice(0, 20).join("\n")

    let output = `<file path="${title}" size="${formatSize(fileSize)}">\n`
    output += content.join("\n")

    const lastReadLine = offset + raw.length
    const truncated = hasMoreLines || truncatedByBytes

    if (truncatedByBytes) {
      output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else {
      const totalLines = lineIndex + (buffer ? 1 : 0)
      output += `\n\n(End of file - total ${totalLines} lines)`
    }
    output += "\n</file>"

    // just warms the lsp client
    LSP.touchFile(filepath, false)
    FileTime.read(ctx.sessionID, filepath)

    if (instructions.length > 0) {
      output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
    }

    return {
      title,
      output,
      metadata: {
        preview,
        truncated,
        size: fileSize,
        sizeHuman: formatSize(fileSize),
        ...(instructions.length > 0 && { loaded: instructions.map((i) => i.filepath) }),
      },
    }
  },
})

async function isBinaryFile(filepath: string, fileSize: number, file: Bun.BunFile): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  // binary check for common non-text extensions
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
  // Only read the first 4KB to check for binary content
  const buffer = await file.slice(0, bufferSize).arrayBuffer()
  if (buffer.byteLength === 0) return false
  const bytes = new Uint8Array(buffer)

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    // NULL byte is a definitive binary indicator
    if (bytes[i] === 0) return true
    // Common control characters (TAB, LF, CR are allowed)
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  // If >30% non-printable characters, consider it binary
  return nonPrintableCount / bytes.length > 0.3
}
