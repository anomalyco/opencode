import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTimes } from "./util/file-times"
import DESCRIPTION from "./multiread.txt"
import { App } from "../app/app"

const MAX_READ_SIZE = 250 * 1024
const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

export const MultiReadTool = Tool.define({
  id: "multiread",
  description: DESCRIPTION,
  parameters: z.object({
    filePaths: z.array(z.string()).describe("Array of file paths to read"),
    offset: z
      .number()
      .describe("The line number to start reading from (0-based) - applies to all files")
      .optional(),
    limit: z
      .number()
      .describe("The number of lines to read (defaults to 2000) - applies to all files")
      .optional(),
  }),
  async execute(params, ctx) {
    const results = []
    const errors = []
    
    for (const filePath of params.filePaths) {
      try {
        let absolutePath = filePath
        if (!path.isAbsolute(filePath)) {
          absolutePath = path.join(process.cwd(), filePath)
        }

        const file = Bun.file(absolutePath)
        if (!(await file.exists())) {
          const dir = path.dirname(absolutePath)
          const base = path.basename(absolutePath)

          const dirEntries = fs.readdirSync(dir)
          const suggestions = dirEntries
            .filter(
              (entry) =>
                entry.toLowerCase().includes(base.toLowerCase()) ||
                base.toLowerCase().includes(entry.toLowerCase()),
            )
            .map((entry) => path.join(dir, entry))
            .slice(0, 3)

          if (suggestions.length > 0) {
            errors.push(`File not found: ${absolutePath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
            continue
          }

          errors.push(`File not found: ${absolutePath}`)
          continue
        }
        
        const stats = await file.stat()

        if (stats.size > MAX_READ_SIZE) {
          errors.push(`File is too large (${stats.size} bytes). Maximum size is ${MAX_READ_SIZE} bytes: ${absolutePath}`)
          continue
        }
        
        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset || 0
        const isImage = isImageFile(absolutePath)
        
        if (isImage) {
          errors.push(`This is an image file of type: ${isImage}. Use a different tool to process images: ${absolutePath}`)
          continue
        }
        
        const lines = await file.text().then((text) => text.split("\n"))
        const raw = lines.slice(offset, offset + limit).map((line) => {
          return line.length > MAX_LINE_LENGTH
            ? line.substring(0, MAX_LINE_LENGTH) + "..."
            : line
        })
        
        const content = raw.map((line, index) => {
          return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
        })
        
        const preview = raw.slice(0, 20).join("\n")

        let fileOutput = `<file path="${path.relative(App.info().path.root, absolutePath)}">\n`
        fileOutput += content.join("\n")

        if (lines.length > offset + content.length) {
          fileOutput += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${
            offset + content.length
          })`
        }
        fileOutput += "\n</file>"

        results.push({
          filePath: absolutePath,
          output: fileOutput,
          preview,
          relativePath: path.relative(App.info().path.root, absolutePath)
        })

        // warm the lsp client
        await LSP.touchFile(absolutePath, true)
        FileTimes.read(ctx.sessionID, absolutePath)
        
      } catch (error) {
        errors.push(`Error reading ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    let output = ""
    if (results.length > 0) {
      output += `Successfully read ${results.length} file(s):\n\n`
      output += results.map(r => r.output).join("\n\n")
    }
    
    if (errors.length > 0) {
      output += `\n\nErrors encountered:\n${errors.join("\n")}`
    }

    return {
      output,
      metadata: {
        filesRead: results.length,
        errors: errors.length,
        files: results.map(r => ({
          path: r.relativePath,
          preview: r.preview
        })),
        title: `Read ${results.length} file(s)${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
      },
    }
  },
})

function isImageFile(filePath: string): string | false {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "JPEG"
    case ".png":
      return "PNG"
    case ".gif":
      return "GIF"
    case ".bmp":
      return "BMP"
    case ".svg":
      return "SVG"
    case ".webp":
      return "WebP"
    default:
      return false
  }
}