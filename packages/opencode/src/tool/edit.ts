// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory } from "./external-directory"
import {
  HashlineEdit,
  applyHashlineEdits,
  hashlineOnlyCreates,
  parseHashlineContent,
  serializeHashlineContent,
} from "./hashline"
import { Config } from "../config/config"

const MAX_DIAGNOSTICS_PER_FILE = 20
const LEGACY_EDIT_MODE = "legacy"
const HASHLINE_EDIT_MODE = "hashline"

const LegacyEditParams = z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z.string().describe("The text to replace it with (must be different from oldString)"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
})

const HashlineEditParams = z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  edits: z.array(HashlineEdit).default([]),
  delete: z.boolean().optional(),
  rename: z.string().optional(),
})

const EditParams = z
  .object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().optional().describe("The text to replace"),
    newString: z.string().optional().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
    edits: z.array(HashlineEdit).optional(),
    delete: z.boolean().optional(),
    rename: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const legacy = value.oldString !== undefined || value.newString !== undefined || value.replaceAll !== undefined
    const hashline = value.edits !== undefined || value.delete !== undefined || value.rename !== undefined

    if (legacy && hashline) {
      ctx.addIssue({
        code: "custom",
        message: "Do not mix legacy (oldString/newString) and hashline (edits/delete/rename) fields.",
      })
      return
    }

    if (!legacy && !hashline) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either legacy fields (oldString/newString) or hashline fields (edits/delete/rename).",
      })
      return
    }

    if (legacy) {
      if (value.oldString === undefined || value.newString === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "Legacy payload requires both oldString and newString.",
        })
      }
      return
    }

    if (value.edits === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Hashline payload requires edits (use [] when only delete is intended).",
      })
    }
  })

type LegacyEditParams = z.infer<typeof LegacyEditParams>
type HashlineEditParams = z.infer<typeof HashlineEditParams>
type EditParams = z.infer<typeof EditParams>

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function isLegacyParams(params: EditParams): params is LegacyEditParams {
  return params.oldString !== undefined || params.newString !== undefined || params.replaceAll !== undefined
}

async function withLocks(paths: string[], fn: () => Promise<void>) {
  const unique = Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b))
  const recurse = async (idx: number): Promise<void> => {
    if (idx >= unique.length) return fn()
    await FileTime.withLock(unique[idx], () => recurse(idx + 1))
  }
  await recurse(0)
}

function createFileDiff(file: string, before: string, after: string): Snapshot.FileDiff {
  const filediff: Snapshot.FileDiff = {
    file,
    before,
    after,
    additions: 0,
    deletions: 0,
  }
  for (const change of diffLines(before, after)) {
    if (change.added) filediff.additions += change.count || 0
    if (change.removed) filediff.deletions += change.count || 0
  }
  return filediff
}

async function diagnosticsOutput(filePath: string, output: string) {
  await LSP.touchFile(filePath, true)
  const diagnostics = await LSP.diagnostics()
  const normalizedFilePath = Filesystem.normalizePath(filePath)
  const issues = diagnostics[normalizedFilePath] ?? []
  const errors = issues.filter((item) => item.severity === 1)
  if (errors.length === 0) {
    return {
      output,
      diagnostics,
    }
  }

  const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
  const suffix =
    errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
  return {
    output:
      output +
      `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`,
    diagnostics,
  }
}

async function executeLegacy(params: LegacyEditParams, ctx: Tool.Context) {
  if (params.oldString === params.newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
  await assertExternalDirectory(ctx, filePath)

  let diff = ""
  let contentOld = ""
  let contentNew = ""
  await FileTime.withLock(filePath, async () => {
    if (params.oldString === "") {
      const existed = await Filesystem.exists(filePath)
      contentNew = params.newString
      diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff,
        },
      })
      await Filesystem.write(filePath, params.newString)
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filePath,
        event: existed ? "change" : "add",
      })
      FileTime.read(ctx.sessionID, filePath)
      return
    }

    const stats = Filesystem.stat(filePath)
    if (!stats) throw new Error(`File ${filePath} not found`)
    if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
    await FileTime.assert(ctx.sessionID, filePath)
    contentOld = await Filesystem.readText(filePath)
    contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll)

    diff = trimDiff(
      createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
    )
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filePath)],
      always: ["*"],
      metadata: {
        filepath: filePath,
        diff,
      },
    })

    await Filesystem.write(filePath, contentNew)
    await Bus.publish(File.Event.Edited, {
      file: filePath,
    })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: filePath,
      event: "change",
    })
    contentNew = await Filesystem.readText(filePath)
    diff = trimDiff(
      createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
    )
    FileTime.read(ctx.sessionID, filePath)
  })

  const filediff = createFileDiff(filePath, contentOld, contentNew)

  ctx.metadata({
    metadata: {
      diff,
      filediff,
      diagnostics: {},
      edit_mode: LEGACY_EDIT_MODE,
    },
  })

  const result = await diagnosticsOutput(filePath, "Edit applied successfully.")

  return {
    metadata: {
      diagnostics: result.diagnostics,
      diff,
      filediff,
      edit_mode: LEGACY_EDIT_MODE,
    },
    title: `${path.relative(Instance.worktree, filePath)}`,
    output: result.output,
  }
}

async function executeHashline(
  params: HashlineEditParams,
  ctx: Tool.Context,
  autocorrect: boolean,
  aggressiveAutocorrect: boolean,
) {
  const sourcePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
  const targetPath = params.rename
    ? path.isAbsolute(params.rename)
      ? params.rename
      : path.join(Instance.directory, params.rename)
    : sourcePath

  await assertExternalDirectory(ctx, sourcePath)
  if (params.rename) {
    await assertExternalDirectory(ctx, targetPath)
  }

  if (params.delete && params.edits.length > 0) {
    throw new Error("delete=true cannot be combined with edits")
  }
  if (params.delete && params.rename) {
    throw new Error("delete=true cannot be combined with rename")
  }

  let diff = ""
  let before = ""
  let after = ""
  let noop = 0
  let deleted = false
  let changed = false
  let diagnostics: Awaited<ReturnType<typeof LSP.diagnostics>> = {}
  const paths = [sourcePath, targetPath]
  await withLocks(paths, async () => {
    const sourceStat = Filesystem.stat(sourcePath)
    if (sourceStat?.isDirectory()) throw new Error(`Path is a directory, not a file: ${sourcePath}`)
    const exists = Boolean(sourceStat)

    if (params.rename && !exists) {
      throw new Error("rename requires an existing source file")
    }

    if (params.delete) {
      if (!exists) {
        noop = 1
        return
      }
      await FileTime.assert(ctx.sessionID, sourcePath)
      before = await Filesystem.readText(sourcePath)
      after = ""
      diff = trimDiff(
        createTwoFilesPatch(sourcePath, sourcePath, normalizeLineEndings(before), normalizeLineEndings(after)),
      )
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, sourcePath)],
        always: ["*"],
        metadata: {
          filepath: sourcePath,
          diff,
        },
      })
      await fs.rm(sourcePath, { force: true })
      await Bus.publish(File.Event.Edited, {
        file: sourcePath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: sourcePath,
        event: "unlink",
      })
      deleted = true
      changed = true
      return
    }

    if (!exists && !hashlineOnlyCreates(params.edits)) {
      throw new Error("Missing file can only be created with append/prepend hashline edits")
    }
    if (exists) {
      await FileTime.assert(ctx.sessionID, sourcePath)
    }

    const parsed = exists
      ? parseHashlineContent(await Filesystem.readBytes(sourcePath))
      : {
          bom: false,
          eol: "\n",
          trailing: false,
          lines: [] as string[],
          text: "",
          raw: "",
        }

    before = parsed.raw
    const next = applyHashlineEdits({
      lines: parsed.lines,
      trailing: parsed.trailing,
      edits: params.edits,
      autocorrect,
      aggressiveAutocorrect,
    })
    const output = serializeHashlineContent({
      lines: next.lines,
      trailing: next.trailing,
      eol: parsed.eol,
      bom: parsed.bom,
    })
    after = output.text

    const noContentChange = before === after && sourcePath === targetPath
    if (noContentChange) {
      noop = 1
      diff = trimDiff(
        createTwoFilesPatch(sourcePath, sourcePath, normalizeLineEndings(before), normalizeLineEndings(after)),
      )
      return
    }

    diff = trimDiff(
      createTwoFilesPatch(sourcePath, targetPath, normalizeLineEndings(before), normalizeLineEndings(after)),
    )
    const patterns = [path.relative(Instance.worktree, sourcePath)]
    if (sourcePath !== targetPath) patterns.push(path.relative(Instance.worktree, targetPath))
    await ctx.ask({
      permission: "edit",
      patterns: Array.from(new Set(patterns)),
      always: ["*"],
      metadata: {
        filepath: sourcePath,
        diff,
      },
    })

    if (sourcePath === targetPath) {
      await Filesystem.write(sourcePath, output.bytes)
      await Bus.publish(File.Event.Edited, {
        file: sourcePath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: sourcePath,
        event: exists ? "change" : "add",
      })
      FileTime.read(ctx.sessionID, sourcePath)
      changed = true
      return
    }

    const targetExists = await Filesystem.exists(targetPath)
    await Filesystem.write(targetPath, output.bytes)
    await fs.rm(sourcePath, { force: true })
    await Bus.publish(File.Event.Edited, {
      file: sourcePath,
    })
    await Bus.publish(File.Event.Edited, {
      file: targetPath,
    })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: sourcePath,
      event: "unlink",
    })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: targetPath,
      event: targetExists ? "change" : "add",
    })
    FileTime.read(ctx.sessionID, targetPath)
    changed = true
  })

  const file = deleted ? sourcePath : targetPath
  const filediff = createFileDiff(file, before, after)
  ctx.metadata({
    metadata: {
      diff,
      filediff,
      diagnostics,
      edit_mode: HASHLINE_EDIT_MODE,
      noop,
    },
  })

  if (!deleted && (changed || noop === 0)) {
    const result = await diagnosticsOutput(targetPath, noop > 0 ? "No changes applied." : "Edit applied successfully.")
    diagnostics = result.diagnostics
    return {
      metadata: {
        diagnostics,
        diff,
        filediff,
        edit_mode: HASHLINE_EDIT_MODE,
        noop,
      },
      title: `${path.relative(Instance.worktree, targetPath)}`,
      output: result.output,
    }
  }

  return {
    metadata: {
      diagnostics,
      diff,
      filediff,
      edit_mode: HASHLINE_EDIT_MODE,
      noop,
    },
    title: `${path.relative(Instance.worktree, file)}`,
    output: deleted ? "Edit applied successfully." : "No changes applied.",
  }
}

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: EditParams,
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    if (isLegacyParams(params)) {
      return executeLegacy(params, ctx)
    }

    const config = await Config.get()
    if (config.experimental?.hashline_edit === false) {
      throw new Error(
        "Hashline edit payload is disabled. Set experimental.hashline_edit to true to use hashline operations.",
      )
    }

    const hashlineParams: HashlineEditParams = {
      filePath: params.filePath,
      edits: params.edits ?? [],
      delete: params.delete,
      rename: params.rename,
    }

    return executeHashline(
      hashlineParams,
      ctx,
      config.experimental?.hashline_autocorrect !== false || Bun.env.OPENCODE_HL_AUTOCORRECT === "1",
      Bun.env.OPENCODE_HL_AUTOCORRECT === "1",
    )
  },
})

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

/**
 * Levenshtein distance algorithm implementation
 */
function levenshtein(a: string, b: string): number {
  // Handle empty strings
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }

    // Look for the matching last line after this first line
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j })
        break // Only match the first occurrence of the last line
      }
    }
  }

  // Return immediately if no candidates
  if (candidates.length === 0) {
    return
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck

        // Exit early when threshold is reached
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break
        }
      }
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity /= linesToCheck // Average similarity
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  // Handle single line matches
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      // Only check for substring matches if the full line doesn't match
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        // Find the actual substring in the original line that matches
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch (e) {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  // Handle multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  // Try direct match with unescaped find string
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) {
    // Need at least 3 lines to have meaningful context
    return
  }

  // Remove trailing empty line if present
  if (findLines[findLines.length - 1] === "") {
    findLines.pop()
  }

  const contentLines = content.split("\n")

  // Extract first and last lines as context anchors
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  // Find blocks that start and end with the context anchors
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue

    // Look for the matching last line
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        // Found a potential context block
        const blockLines = contentLines.slice(i, j + 1)
        const block = blockLines.join("\n")

        // Check if the middle content has reasonable similarity
        // (simple heuristic: at least 50% of non-empty lines should match when trimmed)
        if (blockLines.length === findLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const findLine = findLines[k].trim()

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === findLine) {
                matchingLines++
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break // Only match the first occurrence
          }
        }
        break
      }
    }
  }
}

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  let notFound = true

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (replaceAll) {
        return content.replaceAll(search, newString)
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
}
