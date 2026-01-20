import z from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { assertExternalDirectory } from "./external-directory"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_BYTES = 50 * 1024

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z
    .object({
      filePath: z.string().describe("The path to the file to read").optional(),
      filePaths: z.array(z.string()).describe("Paths to files to read").optional(),
      offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
      limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
    })
    .refine((value) => value.filePath || (value.filePaths && value.filePaths.length > 0), {
      message: "filePath or filePaths is required",
    }),
  async execute(params, ctx) {
    const paths = params.filePaths?.length ? params.filePaths : params.filePath ? [params.filePath] : []
    if (paths.length === 0) throw new Error("filePath or filePaths is required")

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 0

    const readOne = async (value: string) => {
      const filepath = path.isAbsolute(value) ? value : path.join(process.cwd(), value)
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
          },
          attachments: [
            {
              id: Identifier.ascending("part"),
              sessionID: ctx.sessionID,
              messageID: ctx.messageID,
              type: "file" as const,
              mime,
              url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
            },
          ],
        }
      }

      const isBinary = await isBinaryFile(filepath, file)
      if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

      const lines = await file.text().then((text) => text.split("\n"))

      const raw: string[] = []
      let bytes = 0
      let truncatedByBytes = false
      for (let i = offset; i < Math.min(lines.length, offset + limit); i++) {
        const line = lines[i].length > MAX_LINE_LENGTH ? lines[i].substring(0, MAX_LINE_LENGTH) + "..." : lines[i]
        const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
        if (bytes + size > MAX_BYTES) {
          truncatedByBytes = true
          break
        }
        raw.push(line)
        bytes += size
      }

      const content = raw.map((line, index) => {
        return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
      })
      const preview = raw.slice(0, 20).join("\n")

      let output = "<file>\n"
      output += content.join("\n")

      const totalLines = lines.length
      const lastReadLine = offset + raw.length
      const hasMoreLines = totalLines > lastReadLine
      const truncated = hasMoreLines || truncatedByBytes

      if (truncatedByBytes) {
        output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`
      } else if (hasMoreLines) {
        output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
      } else {
        output += `\n\n(End of file - total ${totalLines} lines)`
      }
      output += "\n</file>"

      // just warms the lsp client
      LSP.touchFile(filepath, false)
      FileTime.read(ctx.sessionID, filepath)

      return {
        title,
        output,
        metadata: {
          preview,
          truncated,
        },
      }
    }

    if (paths.length === 1) {
      return readOne(paths[0])
    }

    const results = []
    for (const value of paths) {
      results.push(await readOne(value))
    }

    const output = results.map((result) => result.output).join("\n\n")
    const preview = results.map((result) => result.metadata.preview).join("\n\n")
    const truncated = results.some((result) => result.metadata.truncated)
    const title = results.map((result) => result.title).join(", ")
    const attachments = results.flatMap((result) => result.attachments ?? [])

    if (attachments.length === 0) {
      return {
        title,
        output,
        metadata: {
          preview,
          truncated,
        },
      }
    }

    return {
      title,
      output,
      metadata: {
        preview,
        truncated,
      },
      attachments,
    }
  },
})

async function isBinaryFile(filepath: string, file: Bun.BunFile): Promise<boolean> {
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

  const stat = await file.stat()
  const fileSize = stat.size
  if (fileSize === 0) return false

  const bufferSize = Math.min(4096, fileSize)
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength === 0) return false
  const bytes = new Uint8Array(buffer.slice(0, bufferSize))

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  // If >30% non-printable characters, consider it binary
  return nonPrintableCount / bytes.length > 0.3
}
