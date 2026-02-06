// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
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

const MAX_DIAGNOSTICS_PER_FILE = 20

export function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
    matchStrategy: z
      .enum([
        "simple",
        "multi-occurrence",
        "line-trimmed",
        "block-anchor",
        "whitespace-normalized",
        "indentation-flexible",
        "escape-normalized",
        "trimmed-boundary",
        "context-aware",
        "regex",
      ])
      .optional()
      .describe("The strategy to use for matching oldString"),
    contextLines: z.number().optional().describe("Number of context lines to use for matching (default 3)"),
    dryRun: z.boolean().optional().describe("If true, only return the diff without applying changes"),
    regexFlags: z.string().optional().describe("Regex flags to use if matchStrategy is 'regex' (e.g., 'gi')"),
    anchorLines: z
      .object({
        start: z.number().optional().describe("Start line number to restrict the search"),
        end: z.number().optional().describe("End line number to restrict the search"),
      })
      .optional()
      .describe("Restrict the search to a specific line range"),
    validateOnly: z.boolean().optional().describe("If true, only validate that oldString exists"),
  }),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    if (params.oldString === params.newString) {
      throw new Error("oldString and newString must be different")
    }

    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)

    let diff = ""
    let contentOld = ""
    let contentNew = ""
    const result_output = await FileTime.withLock(filePath, async () => {
      if (params.oldString === "") {
        const existed = await Bun.file(filePath).exists()
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
        await Bun.write(filePath, params.newString)
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

      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => {})
      if (!stats) throw new Error(`File ${filePath} not found`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
      await FileTime.assert(ctx.sessionID, filePath)
      contentOld = await file.text()

      let result: ReplaceResult
      try {
        result = replace(contentOld, params.oldString, params.newString, {
          replaceAll: params.replaceAll,
          matchStrategy: params.matchStrategy,
          regexFlags: params.regexFlags,
          anchorLines: params.anchorLines,
          contextLines: params.contextLines,
        })
      } catch (e: any) {
        if (e.metadata) {
          ctx.metadata({ metadata: e.metadata })
          if (e.metadata.type === "not_found") {
            let msg = e.message
            if (e.metadata.suggestions.length > 0) {
              const s = e.metadata.suggestions[0]
              msg += ` Did you mean line ${s.line}: "${s.content.trim()}"?`
            }
            throw new Error(msg)
          }
          if (e.metadata.type === "multiple_matches") {
            const candidates = e.metadata.candidates
              .map((c: any) => `Line ${c.line}: "${c.content.trim().substring(0, 50)}..."`)
              .join("\n")
            throw new Error(
              `${e.message}\n${candidates}\n\nProvide more surrounding lines in oldString to identify the correct match.`,
            )
          }
        }
        throw e
      }

      contentNew = result.content
      const editInfo = result

      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )

      if (params.validateOnly || params.dryRun) {
        let message = params.validateOnly ? "Validation successful. oldString found." : "Dry run successful."
        return {
          metadata: {
            diff,
            editInfo,
          },
          output: `${message} Changes previewed in diff.\nUsed replacer: ${editInfo.replacer}`,
        }
      }

      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff,
          editInfo,
        },
      })

      await file.write(contentNew)
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filePath,
        event: "change",
      })
      contentNew = await file.text()
      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )
      FileTime.read(ctx.sessionID, filePath)

      let output = "Edit applied successfully."
      if (params.replaceAll) {
        output += ` (Replaced ${editInfo.matches} occurrences using ${editInfo.replacer})`
      } else {
        output += ` (Modified lines ${editInfo.startLine}-${editInfo.endLine} using ${editInfo.replacer})`
      }
      return output
    })

    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }
    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count ?? 0
      if (change.removed) filediff.deletions += change.count ?? 0
    }

    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    let output = typeof result_output === "string" ? result_output : "Edit applied successfully."
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

export type Replacer = (content: string, find: string, options?: ReplaceOptions) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

/**
 * Extracts a match from content based on start and end line indices
 */
function extractMatch(content: string, originalLines: string[], startLine: number, endLine: number): string {
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

  return content.substring(matchStartIndex, matchEndIndex)
}

/**
 * Levenshtein distance algorithm implementation (space-optimized to O(min(m,n)))
 */
function levenshtein(a: string, b: string): number {
  // Prevent excessive memory usage for very large strings
  const MAX_LENGTH = 10000
  if (a.length > MAX_LENGTH || b.length > MAX_LENGTH) {
    // Return a simple approximation for very large strings to avoid O(N^2) time/space
    return Math.abs(a.length - b.length) + (a.slice(0, 100) === b.slice(0, 100) ? 0 : 1)
  }

  // Handle empty strings
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }

  // Ensure 'b' is the shorter string to minimize space usage
  if (a.length < b.length) {
    ;[a, b] = [b, a]
  }

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const currRow = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + cost)
    }
    prevRow = currRow
  }

  return prevRow[b.length]
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
      yield extractMatch(content, originalLines, i, i + searchLines.length - 1)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find, options) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  const contextLines = options?.contextLines ?? 1
  const minBlockSize = Math.max(3, contextLines * 2 + 1)

  if (searchLines.length < minBlockSize) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  const evaluateCandidate = (startLine: number, endLine: number) => {
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
    return similarity
  }

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
    const similarity = evaluateCandidate(startLine, endLine)

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      yield extractMatch(content, originalLines, startLine, endLine)
    }
    return
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const similarity = evaluateCandidate(startLine, endLine)

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    yield extractMatch(content, originalLines, bestMatch.startLine, bestMatch.endLine)
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
      const block = extractMatch(content, lines, i, i + findLines.length - 1)
      if (normalizeWhitespace(block) === normalizedFind) {
        yield block
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
    const block = extractMatch(content, contentLines, i, i + findLines.length - 1)
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(
      /\\(n|t|r|'|"|`|\\|\n|\$|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\})/g,
      (match, captured) => {
        if (captured === "n") return "\n"
        if (captured === "t") return "\t"
        if (captured === "r") return "\r"
        if (captured === "'") return "'"
        if (captured === '"') return '"'
        if (captured === "`") return "`"
        if (captured === "\\") return "\\"
        if (captured === "\n") return "\n"
        if (captured === "$") return "$"
        if (captured.startsWith("x")) return String.fromCharCode(parseInt(captured.slice(1), 16))
        if (captured.startsWith("u{")) return String.fromCodePoint(parseInt(captured.slice(2, -1), 16))
        if (captured.startsWith("u")) return String.fromCharCode(parseInt(captured.slice(1), 16))
        return match
      },
    )
  }

  const unescapedFind = unescapeString(find)
  const findLines = unescapedFind.split("\n")
  const lines = content.split("\n")

  // Combine direct match check with sliding window scanning to avoid double scanning the whole content
  let hasYieldedDirect = false

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = extractMatch(content, lines, i, i + findLines.length - 1)

    // Check for direct match of unescaped version (as a substring or exact line)
    if (!hasYieldedDirect && block.includes(unescapedFind)) {
      yield unescapedFind
      hasYieldedDirect = true
    }

    // Check for escaped versions in content
    const unescapedBlock = unescapeString(block)
    if (unescapedBlock === unescapedFind && block !== unescapedFind) {
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
    const block = extractMatch(content, lines, i, i + findLines.length - 1)

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
        const block = extractMatch(content, contentLines, i, j)
        const blockLines = contentLines.slice(i, j + 1)

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

export const RegexReplacer = (flags = "g"): Replacer => {
  return function* (content, find) {
    try {
      const regex = new RegExp(find, flags)
      let match
      while ((match = regex.exec(content)) !== null) {
        yield match[0]
        if (!regex.global) break
      }
    } catch (e) {
      // Invalid regex, skip
    }
  }
}

export const REPLACER_MAP: Record<string, Replacer | ((opts?: any) => Replacer)> = {
  simple: SimpleReplacer,
  "multi-occurrence": MultiOccurrenceReplacer,
  "line-trimmed": LineTrimmedReplacer,
  "block-anchor": BlockAnchorReplacer,
  "whitespace-normalized": WhitespaceNormalizedReplacer,
  "indentation-flexible": IndentationFlexibleReplacer,
  "escape-normalized": EscapeNormalizedReplacer,
  "trimmed-boundary": TrimmedBoundaryReplacer,
  "context-aware": ContextAwareReplacer,
  regex: (opts: any) => RegexReplacer(opts?.regexFlags || "g"),
}

export const DEFAULT_REPLACERS = [
  "simple",
  "multi-occurrence",
  "line-trimmed",
  "block-anchor",
  "whitespace-normalized",
  "indentation-flexible",
  "escape-normalized",
  "trimmed-boundary",
  "context-aware",
]

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  let min = Infinity

  // Single pass to find min indentation of content lines
  for (const line of lines) {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const content = line.slice(1)
      if (content.trim().length > 0) {
        const match = content.match(/^(\s*)/)
        if (match) min = Math.min(min, match[1].length)
      }
    }
  }

  if (min === Infinity || min === 0) return diff

  // Single pass to trim and join
  let result = ""
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      result += line[0] + line.slice(1 + min)
    } else {
      result += line
    }
    if (i < lines.length - 1) result += "\n"
  }

  return result
}

function escapeForRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export interface ReplaceOptions {
  replaceAll?: boolean
  matchStrategy?: string
  regexFlags?: string
  anchorLines?: { start?: number; end?: number }
  contextLines?: number
}

export interface ReplaceResult {
  content: string
  replacer: string
  matches?: number
  startLine?: number
  endLine?: number
}

export function replace(
  content: string,
  oldString: string,
  newString: string,
  options: ReplaceOptions = {},
): ReplaceResult {
  const { replaceAll = false, matchStrategy, anchorLines } = options

  if (oldString === newString) {
    throw new Error("oldString and newString must be different")
  }

  // Restrict content if anchorLines are provided
  let effectiveContent = content
  let contentOffset = 0
  if (anchorLines) {
    const lines = content.split("\n")
    const start = Math.max(1, anchorLines.start || 1)
    const end = Math.min(lines.length, anchorLines.end || lines.length)

    if (start > end) {
      throw new Error(`Invalid anchorLines: start (${start}) is greater than end (${end})`)
    }

    effectiveContent = lines.slice(start - 1, end).join("\n")
    contentOffset = lines.slice(0, start - 1).reduce((sum, line) => sum + line.length + 1, 0)
  }

  const replacerNames = matchStrategy ? [matchStrategy] : DEFAULT_REPLACERS
  const replacers = replacerNames
    .map((name) => {
      const r = REPLACER_MAP[name]
      if (!r) return null
      return {
        name,
        fn: typeof r === "function" && r.length === 1 ? (r as any)(options) : (r as Replacer),
      }
    })
    .filter((r): r is { name: string; fn: Replacer } => r !== null)

  if (replaceAll) {
    for (const replacer of replacers) {
      const matches = Array.from(replacer.fn(effectiveContent, oldString, options))
      if (matches.length > 0) {
        let newContent = effectiveContent
        if (replacer.name === "regex") {
          newContent = effectiveContent.replace(new RegExp(oldString, options.regexFlags || "g"), newString)
        } else {
          // Replace all unique matches found by the fuzzy replacer
          const uniqueMatches = Array.from(new Set(matches))
          // Sort by length descending to avoid partial replacements of longer matches
          uniqueMatches.sort((a, b) => b.length - a.length)

          for (const match of uniqueMatches) {
            newContent = newContent.replace(new RegExp(escapeForRegExp(match), "g"), newString)
          }
        }

        return {
          content:
            content.substring(0, contentOffset) +
            newContent +
            content.substring(contentOffset + effectiveContent.length),
          replacer: replacer.name,
          matches: matches.length,
        }
      }
    }
  } else {
    const allMatches: Array<{ search: string; index: number; replacer: string }> = []

    for (const replacer of replacers) {
      for (const search of replacer.fn(effectiveContent, oldString, options)) {
        const index = effectiveContent.indexOf(search)
        if (index === -1) continue

        const lastIndex = effectiveContent.lastIndexOf(search)
        if (index !== lastIndex) {
          continue
        }

        const absoluteIndex = contentOffset + index
        const startLine = content.substring(0, absoluteIndex).split("\n").length
        const endLine = startLine + search.split("\n").length - 1

        return {
          content: content.substring(0, absoluteIndex) + newString + content.substring(absoluteIndex + search.length),
          replacer: replacer.name,
          startLine,
          endLine,
        }
      }

      for (const search of replacer.fn(effectiveContent, oldString, options)) {
        let idx = effectiveContent.indexOf(search)
        while (idx !== -1) {
          allMatches.push({ search, index: contentOffset + idx, replacer: replacer.name })
          idx = effectiveContent.indexOf(search, idx + 1)
        }
      }
      if (allMatches.length > 0) break
    }

    if (allMatches.length === 0) {
      const lines = effectiveContent.split("\n")
      const searchFirstLine = oldString.split("\n")[0].trim()
      let bestMatch = { line: -1, similarity: 0, content: "" }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line.length === 0) continue
        const sim = 1 - levenshtein(line, searchFirstLine) / Math.max(line.length, searchFirstLine.length)
        if (sim > bestMatch.similarity) {
          bestMatch = { line: (anchorLines?.start || 1) + i, similarity: sim, content: lines[i] }
        }
      }

      const error: any = new Error(`oldString not found in content.`)
      error.metadata = {
        type: "not_found",
        suggestions: bestMatch.line !== -1 && bestMatch.similarity > 0.7 ? [bestMatch] : [],
      }
      throw error
    }

    if (allMatches.length > 1) {
      const candidates = allMatches.map((m) => {
        const line = content.substring(0, m.index).split("\n").length
        return {
          line,
          content: m.search.split("\n")[0],
          replacer: m.replacer,
        }
      })

      const error: any = new Error(`Found multiple matches for oldString (${allMatches.length} total).`)
      error.metadata = {
        type: "multiple_matches",
        candidates: candidates.slice(0, 10),
      }
      throw error
    }
  }

  throw new Error("Unexpected error in replace function")
}
