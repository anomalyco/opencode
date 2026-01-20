import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./replace-selection.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { SelectionUtils } from "./selection-utils"
import { FileTime } from "../file/time"
import { Bus } from "../bus"
import { File } from "../file"
import { LSP } from "../lsp"
import { Snapshot } from "@/snapshot"
import { Filesystem } from "../util/filesystem"

const MAX_DIAGNOSTICS_PER_FILE = 20

export const ReplaceSelectionTool = Tool.define("replace-selection", {
  description: DESCRIPTION,
  parameters: z.object({
    replace: z.string().describe("The new content to replace the selection with"),
  }),
  async execute(params, ctx) {
    const conversation = await ctx.getConversation()
    let lastSelectPart = null
    let foundReplaceAfterSelect = false

    for (let i = conversation.length - 1; i >= 0; i--) {
      const msg = conversation[i]
      if (msg.info.role !== "assistant") continue

      for (const part of msg.parts) {
        if (part.type === "tool" && part.state.status === "completed") {
          if (!foundReplaceAfterSelect && part.tool === "replace-selection") {
            foundReplaceAfterSelect = true
            continue
          }
          if (part.tool === "select-text" && !foundReplaceAfterSelect) {
            lastSelectPart = part
            break
          }
        }
      }
      if (lastSelectPart) break
    }

    if (!lastSelectPart) {
      throw new Error("No valid selection found. You must call select-text before replace-selection.")
    }

    const { filePath, searchStart, searchEnd } = lastSelectPart.state.input

    let filepath = filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(Instance.worktree, filepath)
    }

    await assertExternalDirectory(ctx, filepath)

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      let entries: string[] = []
      try {
        const glob = new Bun.Glob("*")
        entries = await Array.fromAsync(glob.scan({ cwd: dir }))
      } catch {
        entries = []
      }

      const suggestions = entries
        .filter(
          (entry: string) =>
            entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
        )
        .slice(0, 3)

      const suggestionsMessage =
        suggestions.length > 0
          ? `\n\nDid you mean one of these?\n${suggestions.map((e) => path.join(dir, e)).join("\n")}`
          : ""

      throw new Error(`File not found: ${filepath}${suggestionsMessage}`)
    }

    const isBinary = await isBinaryFile(filepath, file)
    if (isBinary) {
      throw new Error(`Cannot edit binary file: ${filepath}`)
    }

    let contentOld = ""
    let contentNew = ""

    await FileTime.withLock(filepath, async () => {
      await FileTime.assert(ctx.sessionID, filepath)

      contentOld = await file.text()
      const [startIndexMatchesNewLine, startIndex, endIndex] = SelectionUtils.findStartEndIndices(
        contentOld,
        searchStart,
        searchEnd ?? "",
      )

      const selectedText = contentOld.substring(startIndex, endIndex)
      if (selectedText.length / contentOld.length > 0.8) {
        throw new Error(
          "Selection is too large for replacement. The selected text is more than 80% of the file content.",
        )
      }

      let finalStartIndex = startIndex
      const isTabOrSpace = (char: string) => char === " " || char === "\t"

      if (!startIndexMatchesNewLine && params.replace.length > 0 && isTabOrSpace(params.replace[0])) {
        let needsAutoIndent = true
        let check = startIndex - 1
        while (check >= 0) {
          if (contentOld[check] === "\n") {
            break
          }
          if (contentOld[check] !== " " && contentOld[check] !== "\t") {
            needsAutoIndent = false
            break
          }
          check--
        }
        if (needsAutoIndent) {
          finalStartIndex = check + 1
        }
      }

      contentNew = contentOld.substring(0, finalStartIndex) + params.replace + contentOld.substring(endIndex)

      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filepath)],
        always: ["*"],
        metadata: {
          filepath,
          before: selectedText,
          after: params.replace,
        },
      })

      await file.write(contentNew)
      await Bus.publish(File.Event.Edited, {
        file: filepath,
      })

      contentNew = await file.text()
      FileTime.read(ctx.sessionID, filepath)
    })

    const filediff: Snapshot.FileDiff = {
      file: filepath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }
    const diff = createTwoFilesPatch(filepath, filepath, contentOld, contentNew)

    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count || 0
      if (change.removed) filediff.deletions += change.count || 0
    }

    ctx.metadata({
      metadata: {
        diff,
        filediff,
      },
    })

    let output = "Selection replaced successfully."
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedPath = Filesystem.normalizePath(filepath)
    const issues = diagnostics[normalizedPath] ?? []
    const errors = issues.filter((item) => item.severity === 1)

    if (errors.length > 0) {
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited
        .map((d) => d.message)
        .join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      metadata: {
        diff,
        filediff,
      },
      title: path.relative(Instance.worktree, filepath),
      output,
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
  const fileSize = stat.size ?? 0
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
