import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./hashline.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory } from "./external-directory"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_MISMATCH_LINES = 5
const MAX_MISMATCH_LINE_LENGTH = 200
const HASH_LEN = 2
const RADIX = 16
const HASH_MOD = RADIX ** HASH_LEN
const DICT = Array.from({ length: HASH_MOD }, (_, i) => i.toString(RADIX).padStart(HASH_LEN, "0"))

function computeLineHash(idx: number, line: string): string {
  if (line.endsWith("\r")) {
    line = line.slice(0, -1)
  }
  line = line.replace(/\s+/g, "")
  return DICT[Bun.hash.xxHash32(line) % HASH_MOD]
}

function parseLineRef(ref: string): { line: number; hash: string } {
  const cleaned = ref
    .replace(/\|.*$/, "")
    .replace(/ {2}.*$/, "")
    .trim()
  const normalized = cleaned.replace(/\s*:\s*/, ":")
  const match = normalized.match(/^(\d+):([0-9a-zA-Z]{1,16})$/)
  if (!match) {
    throw new Error(`Invalid line reference "${ref}". Expected format "LINE:HASH" (e.g. "5:aa").`)
  }
  const line = Number.parseInt(match[1], 10)
  if (line < 1) {
    throw new Error(`Line number must be >= 1, got ${line} in "${ref}".`)
  }
  return { line, hash: match[2] }
}

function validateLineRef(ref: { line: number; hash: string }, fileLines: string[]): void {
  if (ref.line < 1 || ref.line > fileLines.length) {
    throw new Error(`Line ${ref.line} does not exist (file has ${fileLines.length} lines)`)
  }
  const actualHash = computeLineHash(ref.line, fileLines[ref.line - 1])
  if (actualHash !== ref.hash.toLowerCase()) {
    throw new HashlineMismatchError([{ line: ref.line, expected: ref.hash, actual: actualHash }], fileLines)
  }
}

class HashlineMismatchError extends Error {
  readonly remaps: ReadonlyMap<string, string>
  constructor(
    public readonly mismatches: Array<{ line: number; expected: string; actual: string }>,
    public readonly fileLines: string[],
  ) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines))
    this.name = "HashlineMismatchError"
    const remaps = new Map<string, string>()
    for (const m of mismatches) {
      const actual = computeLineHash(m.line, fileLines[m.line - 1])
      remaps.set(`${m.line}:${m.expected}`, `${m.line}:${actual}`)
    }
    this.remaps = remaps
  }

  static formatMessage(
    mismatches: Array<{ line: number; expected: string; actual: string }>,
    fileLines: string[],
  ): string {
    function clip(content: string) {
      if (content.length <= MAX_MISMATCH_LINE_LENGTH) return content
      return content.slice(0, MAX_MISMATCH_LINE_LENGTH) + "..."
    }

    const lines: string[] = []
    const shown = mismatches.slice(0, MAX_MISMATCH_LINES)
    lines.push(
      `${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. Use the updated LINE:HASH references shown below.`,
    )
    lines.push("")
    for (const m of shown) {
      const content = fileLines[m.line - 1]
      const actual = computeLineHash(m.line, content)
      lines.push(`>>> ${m.line}:${actual}|${clip(content)}`)
    }
    if (mismatches.length > shown.length) {
      lines.push(`... and ${mismatches.length - shown.length} more mismatches`)
    }
    lines.push("")
    lines.push("Quick fix — replace stale refs:")
    for (const m of shown) {
      const actual = computeLineHash(m.line, fileLines[m.line - 1])
      lines.push(`\t${m.line}:${m.expected} → ${m.line}:${actual}`)
    }
    if (mismatches.length > shown.length) {
      lines.push(`\t... and ${mismatches.length - shown.length} more remaps`)
    }
    return lines.join("\n")
  }
}

type HashlineEdit =
  | { set_line: { anchor: string; new_text: string } }
  | { replace_lines: { start_anchor: string; end_anchor?: string; new_text?: string } }
  | { insert_after: { anchor: string; text: string } }
  | { replace: { old_text: string; new_text: string; all?: boolean } }

function applyHashlineEdits(
  content: string,
  edits: HashlineEdit[],
): { content: string; firstChangedLine: number | undefined } {
  if (edits.length === 0) {
    return { content, firstChangedLine: undefined }
  }

  const fileLines = content.split("\n")
  let firstChangedLine: number | undefined

  function trackFirstChanged(line: number) {
    if (firstChangedLine === undefined || line < firstChangedLine) {
      firstChangedLine = line
    }
  }

  for (const edit of edits) {
    if ("set_line" in edit) {
      const ref = parseLineRef(edit.set_line.anchor)
      validateLineRef(ref, fileLines)
      const newLines = edit.set_line.new_text.split("\n")
      fileLines.splice(ref.line - 1, 1, ...newLines)
      trackFirstChanged(ref.line)
    } else if ("replace_lines" in edit) {
      const startRef = parseLineRef(edit.replace_lines.start_anchor)
      validateLineRef(startRef, fileLines)

      if (edit.replace_lines.end_anchor) {
        const endRef = parseLineRef(edit.replace_lines.end_anchor)
        validateLineRef(endRef, fileLines)
        const count = endRef.line - startRef.line + 1
        const newText = edit.replace_lines.new_text ?? ""
        const newLines = newText.split("\n")
        fileLines.splice(startRef.line - 1, count, ...newLines)
        trackFirstChanged(startRef.line)
      } else {
        const newText = edit.replace_lines.new_text ?? ""
        const newLines = newText.split("\n")
        fileLines.splice(startRef.line - 1, 1, ...newLines)
        trackFirstChanged(startRef.line)
      }
    } else if ("insert_after" in edit) {
      const ref = parseLineRef(edit.insert_after.anchor)
      validateLineRef(ref, fileLines)
      const newLines = edit.insert_after.text.split("\n")
      fileLines.splice(ref.line, 0, ...newLines)
      trackFirstChanged(ref.line + 1)
    } else if ("replace" in edit) {
      if (edit.replace.old_text === edit.replace.new_text) {
        throw new Error("old_text and new_text are identical")
      }

      if (edit.replace.all) {
        const changed = fileLines
          .map((line, idx) => {
            if (!line.includes(edit.replace.old_text)) return undefined
            trackFirstChanged(idx + 1)
            return { idx, line: line.replaceAll(edit.replace.old_text, edit.replace.new_text) }
          })
          .filter((item): item is { idx: number; line: string } => item !== undefined)
        if (changed.length === 0) {
          throw new Error(`old_text not found: ${edit.replace.old_text}`)
        }
        for (const item of changed) {
          fileLines[item.idx] = item.line
        }
        continue
      }

      const idx = fileLines.findIndex((line) => line.includes(edit.replace.old_text))
      if (idx === -1) {
        throw new Error(`old_text not found: ${edit.replace.old_text}`)
      }
      fileLines[idx] = fileLines[idx].replace(edit.replace.old_text, edit.replace.new_text)
      trackFirstChanged(idx + 1)
    }
  }

  return { content: fileLines.join("\n"), firstChangedLine }
}

const HashlineParams = z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  operations: z
    .array(
      z.discriminatedUnion("op", [
        z.object({
          op: z.literal("set_line"),
          anchor: z.string().describe("Line anchor in format LINE:HASH (e.g., '5:aa')"),
          new_text: z.string().describe("New text to replace the line with"),
        }),
        z.object({
          op: z.literal("replace_lines"),
          start_anchor: z.string().describe("Start line anchor in format LINE:HASH"),
          end_anchor: z.string().optional().describe("End line anchor in format LINE:HASH"),
          new_text: z.string().optional().describe("Text to replace the range with"),
        }),
        z.object({
          op: z.literal("insert_after"),
          anchor: z.string().describe("Line anchor to insert after in format LINE:HASH"),
          text: z.string().describe("Text to insert after the anchor line"),
        }),
        z.object({
          op: z.literal("replace"),
          old_text: z.string().describe("Text to find and replace"),
          new_text: z.string().describe("Text to replace it with"),
          all: z.boolean().optional().describe("Replace all occurrences"),
        }),
      ]),
    )
    .describe("Array of hashline edit operations to apply"),
})

export const HashlineTool = Tool.define("hashline", {
  description: DESCRIPTION,
  parameters: HashlineParams,
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    if (!params.operations || params.operations.length === 0) {
      throw new Error("operations array is required and must not be empty")
    }

    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)

    let contentOld = ""
    let contentNew = ""
    let diff = ""
    let firstChangedLine: number | undefined

    await FileTime.withLock(filePath, async () => {
      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => {})
      if (!stats) throw new Error(`File ${filePath} not found`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)

      await FileTime.assert(ctx.sessionID, filePath)
      contentOld = await file.text()

      const edits: HashlineEdit[] = params.operations.map((op) => {
        if (op.op === "set_line") {
          return { set_line: { anchor: op.anchor, new_text: op.new_text } }
        } else if (op.op === "replace_lines") {
          return { replace_lines: { start_anchor: op.start_anchor, end_anchor: op.end_anchor, new_text: op.new_text } }
        } else if (op.op === "insert_after") {
          return { insert_after: { anchor: op.anchor, text: op.text } }
        } else {
          return { replace: { old_text: op.old_text, new_text: op.new_text, all: op.all } }
        }
      })

      try {
        const result = applyHashlineEdits(contentOld, edits)
        contentNew = result.content
        firstChangedLine = result.firstChangedLine
      } catch (error) {
        if (error instanceof HashlineMismatchError) {
          throw error
        }
        throw error
      }

      diff = createTwoFilesPatch(filePath, filePath, contentOld, contentNew)

      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff,
        },
      })

      await file.write(contentNew)
      await Bus.publish(File.Event.Edited, { file: filePath })
      await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })

      FileTime.read(ctx.sessionID, filePath)
    })

    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }
    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count || 0
      if (change.removed) filediff.deletions += change.count || 0
    }

    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    let output = "Hashline edit applied successfully."
    if (firstChangedLine !== undefined) {
      output += ` (first changed line: ${firstChangedLine})`
    }

    await LSP.touchFile(filePath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilePath = Filesystem.normalizePath(filePath)
    const issues = diagnostics[normalizedFilePath] ?? []
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length > 0) {
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      metadata: {
        diagnostics,
        diff,
        filediff,
      },
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    }
  },
})
