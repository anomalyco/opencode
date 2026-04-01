import z from "zod"
import { text } from "node:stream/consumers"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"
import { assertSafePath } from "./path-guard"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
    mode: z
      .enum(["content", "files_with_matches", "count"])
      .optional()
      .describe(
        "Output mode: content (default, show matching lines), files_with_matches (list files only), count (count of matches per file)",
      ),
    contextLines: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Number of context lines to show before and after each match"),
    multiline: z.boolean().optional().describe("Enable multiline matching (. matches newline)"),
    offset: z.number().int().min(0).optional().describe("Skip the first N matches (for pagination)"),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)

    // Hard-block dangerous paths before any other checks
    assertSafePath(searchPath)

    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const isSummaryMode = params.mode === "files_with_matches" || params.mode === "count"
    // -nH and --field-match-separator are only needed for content mode
    const args = isSummaryMode
      ? ["--hidden", "--no-messages", "--regexp", params.pattern]
      : ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    if (params.mode === "files_with_matches") {
      args.push("--files-with-matches")
    } else if (params.mode === "count") {
      args.push("--count")
    }
    if (params.contextLines && params.contextLines > 0) {
      args.push("-C", String(params.contextLines))
    }
    if (params.multiline) {
      args.push("--multiline")
    }
    args.push(searchPath)

    const proc = Process.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      abort: ctx.abort,
    })

    if (!proc.stdout || !proc.stderr) {
      throw new Error("Process output not available")
    }

    const output = await text(proc.stdout)
    const errorOutput = await text(proc.stderr)
    const exitCode = await proc.exited

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches)
    // With --no-messages, we suppress error output but still get exit code 2 for broken symlinks etc.
    // Only fail if exit code is 2 AND no output was produced
    if (exitCode === 1 || (exitCode === 2 && !output.trim())) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0 && exitCode !== 2) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const hasErrors = exitCode === 2
    const rawLines = output.trim().split(/\r?\n/)

    // files_with_matches mode: output is one file path per line
    if (params.mode === "files_with_matches") {
      const files = rawLines.filter(Boolean)
      const skip = params.offset ?? 0
      const paged = skip > 0 ? files.slice(skip) : files
      const limit = 100
      const truncated = paged.length > limit
      const shown = truncated ? paged.slice(0, limit) : paged
      const outputLines = [`Found ${files.length} file(s)${skip > 0 ? ` (skipping first ${skip})` : ""}`, ...shown]
      if (truncated) outputLines.push(`(showing ${limit} of ${files.length})`)
      if (hasErrors) outputLines.push("(Some paths were inaccessible and skipped)")
      return {
        title: params.pattern,
        metadata: { matches: files.length, truncated },
        output: outputLines.join("\n"),
      }
    }

    // count mode: output is "filePath:count" per file
    if (params.mode === "count") {
      const entries = rawLines
        .filter(Boolean)
        .map((line) => {
          const sep = line.lastIndexOf(":")
          return { path: line.slice(0, sep), count: parseInt(line.slice(sep + 1), 10) || 0 }
        })
        .filter((e) => e.count > 0)
      const total = entries.reduce((s, e) => s + e.count, 0)
      const skip = params.offset ?? 0
      const paged = skip > 0 ? entries.slice(skip) : entries
      const limit = 100
      const truncated = paged.length > limit
      const shown = truncated ? paged.slice(0, limit) : paged
      const outputLines = [
        `Found ${total} matches across ${entries.length} file(s)${skip > 0 ? ` (skipping first ${skip} files)` : ""}`,
        ...shown.map((e) => `  ${e.path}: ${e.count}`),
      ]
      if (truncated) outputLines.push(`(showing ${limit} of ${entries.length} files)`)
      if (hasErrors) outputLines.push("(Some paths were inaccessible and skipped)")
      return {
        title: params.pattern,
        metadata: { matches: total, truncated },
        output: outputLines.join("\n"),
      }
    }

    // content mode (default): output is "filePath|lineNum|content" per match
    const matches = []

    for (const line of rawLines) {
      if (!line) continue

      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")

      const stats = Filesystem.stat(filePath)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    // Offset-based pagination: skip the first N matches
    const skip = params.offset ?? 0
    const paged = skip > 0 ? matches.slice(skip) : matches

    const limit = 100
    const truncated = paged.length > limit
    const finalMatches = truncated ? paged.slice(0, limit) : paged

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const totalMatches = matches.length
    const shown = paged.length
    const outputLines = [
      `Found ${totalMatches} matches${skip > 0 ? ` (skipping first ${skip})` : ""}${truncated ? `, showing ${limit} of ${shown}` : ""}`,
    ]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push(
        `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
      )
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: totalMatches,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
