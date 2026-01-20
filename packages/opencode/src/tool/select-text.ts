import z from "zod"
import * as path from "path"
import * as fs from "fs"
import { Tool } from "./tool"
import DESCRIPTION from "./select-text.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { SelectionUtils } from "./selection-utils"

export const SelectTextTool = Tool.define("select-text", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The path to the file to search in"),
    searchStart: z
      .string()
      .describe("The exact start string to find and select. Selection is inclusive of searchStart."),
    searchEnd: z
      .string()
      .optional()
      .describe(
        "Optional: Exact string to find and select up to. If not provided, only the text containing searchStart is selected. Selection behavior of searchEnd must be specified. For example, you may want it to be true to match a closing bracket of the searchStart code block. Or false, to match, but not include the start of the next code block.",
      ),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(Instance.worktree, filepath)
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

      const dirEntries = fs.readdirSync(dir)
      const suggestions = dirEntries
        .filter(
          (entry) =>
            entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
        )
        .map((entry) => path.join(dir, entry))
        .slice(0, 3)

      const suggestionsMessage =
        suggestions.length > 0 ? `\n\nDid you mean one of these?\n${suggestions.join("\n")}` : ""

      throw new Error(`File not found: ${filepath}${suggestionsMessage}`)
    }

    const isBinary = await isBinaryFile(filepath, file)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    const content = await file.text()
    const [startIndexMatchesNewLine, startIndex, endIndex] = SelectionUtils.findStartEndIndices(
      content,
      params.searchStart,
      params.searchEnd ?? "",
    )
    const selectedText = content.substring(startIndex, endIndex)

    if (selectedText.length / content.length > 0.8) {
      throw new Error("Selection is too large. The selected text is more than 80% of the file content.")
    }

    const message = startIndexMatchesNewLine
      ? `The following text was selected for replacement in "${title}":\n\n${selectedText}`
      : `WARNING: The searchStart parameter did not exactly match leading whitespace, however a unique match was found. You MUST try to match whitespace when using the select-text tool. The following text was selected for replacement in "${title}":\n\n${selectedText}`

    return {
      title,
      output: message,
      metadata: {
        filePath: params.filePath,
        searchStart: params.searchStart,
        searchEnd: params.searchEnd,
      },
    }
  },
})

async function isBinaryFile(filepath: string, file: Bun.BunFile): Promise<boolean> {
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
  return nonPrintableCount / bytes.length > 0.3
}
