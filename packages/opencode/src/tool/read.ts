import z from "zod"
import { createReadStream } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { createInterface } from "readline"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { InstructionPrompt } from "../session/instruction"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file or directory to read"),
    offset: z.coerce.number().describe("The line number to start reading from (1-indexed)").optional(),
    limit: z.coerce.number().describe("The maximum number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    if (params.offset !== undefined && params.offset < 1) {
      throw new Error("offset must be greater than or equal to 1")
    }
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }
    const title = path.relative(Instance.worktree, filepath)

    const file = Bun.file(filepath)
    const stat = await file.stat().catch(() => undefined)

    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
      kind: stat?.isDirectory() ? "directory" : "file",
    })

    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    if (!stat) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      const suggestions = await fs
        .readdir(dir)
        .then((entries) =>
          entries
            .filter(
              (entry) =>
                entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
            )
            .map((entry) => path.join(dir, entry))
            .slice(0, 3),
        )
        .catch(() => [])

      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
      }

      throw new Error(`File not found: ${filepath}`)
    }

    if (stat.isDirectory()) {
      const dirents = await fs.readdir(filepath, { withFileTypes: true })
      const entries = await Promise.all(
        dirents.map(async (dirent) => {
          if (dirent.isDirectory()) return dirent.name + "/"
          if (dirent.isSymbolicLink()) {
            const target = await fs.stat(path.join(filepath, dirent.name)).catch(() => undefined)
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
        `<path>${filepath}</path>`,
        `<type>directory</type>`,
        `<entries>`,
        sliced.join("\n"),
        truncated
          ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
          : `\n(${entries.length} entries)`,
        `</entries>`,
      ].join("\n")

      return {
        title,
        output,
        metadata: {
          preview: sliced.slice(0, 20).join("\n"),
          truncated,
          loaded: [] as string[],
        },
      }
    }

    const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)

    // Exclude SVG (XML-based) and vnd.fastbidsheet (.fbs extension, commonly FlatBuffers schema files)
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
          loaded: instructions.map((i) => i.filepath),
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

    const isBinary = await isBinaryFile(filepath, stat.size)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    const stream = createReadStream(filepath, { encoding: "utf8" })
    const rl = createInterface({
      input: stream,
      // Note: we use the crlfDelay option to recognize all instances of CR LF
      // ('\r\n') in file as a single line break.
      crlfDelay: Infinity,
    })

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset ?? 1
    const start = offset - 1
    const raw: string[] = []
    let bytes = 0
    let lines = 0
    let truncatedByBytes = false
    let hasMoreLines = false
    try {
      for await (const text of rl) {
        lines += 1
        if (lines <= start) continue

        if (raw.length >= limit) {
          hasMoreLines = true
          continue
        }

        const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
        const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
        if (bytes + size > MAX_BYTES) {
          truncatedByBytes = true
          hasMoreLines = true
          break
        }

        raw.push(line)
        bytes += size
      }
    } finally {
      rl.close()
      stream.destroy()
    }

    if (lines < offset && !(lines === 0 && offset === 1)) {
      throw new Error(`Offset ${offset} is out of range for this file (${lines} lines)`)
    }

    const content = raw.map((line, index) => {
      return `${index + offset}: ${line}`
    })
    const preview = raw.slice(0, 20).join("\n")

    let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>"].join("\n")
    output += content.join("\n")

    const totalLines = lines
    const lastReadLine = offset + raw.length - 1
    const nextOffset = lastReadLine + 1
    const truncated = hasMoreLines || truncatedByBytes

    if (truncatedByBytes) {
      output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${lastReadLine}. Use offset=${nextOffset} to continue.)`
    } else if (hasMoreLines) {
      output += `\n\n(Showing lines ${offset}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`
    } else {
      output += `\n\n(End of file - total ${totalLines} lines)`
    }
    output += "\n</content>"

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
        loaded: instructions.map((i) => i.filepath),
      },
    }
  },
})

async function isBinaryFile(filepath: string, fileSize: number): Promise<boolean> {
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

  const fh = await fs.open(filepath, "r")
  try {
    const sampleSize = Math.min(4096, fileSize)
    const bytes = Buffer.alloc(sampleSize)
    const result = await fh.read(bytes, 0, sampleSize, 0)
    if (result.bytesRead === 0) return false

    let nonPrintableCount = 0
    for (let i = 0; i < result.bytesRead; i++) {
      if (bytes[i] === 0) return true
      if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
        nonPrintableCount++
      }
    }
    // If >30% non-printable characters, consider it binary
    return nonPrintableCount / result.bytesRead > 0.3
  } finally {
    await fh.close()
  }
}
