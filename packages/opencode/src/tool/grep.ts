import z from "zod"
import { text } from "node:stream/consumers"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"
import { convertOfficeToMarkdown, isOfficeDocumentPath } from "../util/markitdown"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE_LENGTH = 2000
const OFFICE_FILE_SCAN_LIMIT = 20

type Match = {
  path: string
  modTime: number
  lineNum: number
  lineText: string
}

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
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
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
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

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = output.trim().split(/\r?\n/)
    const matches: Match[] = []

    for (const line of lines) {
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

    const officeSearch = await findOfficeMatches({
      searchPath,
      pattern: params.pattern,
      include: params.include,
      abort: ctx.abort,
    })
    matches.push(...officeSearch.matches)

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const totalMatches = matches.length
    const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`]

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

    if (officeSearch.filesSkipped > 0) {
      outputLines.push("")
      outputLines.push(
        `(Some office files were skipped after conversion errors: ${officeSearch.filesSkipped}${officeSearch.skipPreview ? `; e.g. ${officeSearch.skipPreview}` : ""})`,
      )
    }

    if (officeSearch.filesCapped) {
      outputLines.push("")
      outputLines.push(
        `(Office-file scanning capped at ${OFFICE_FILE_SCAN_LIMIT} files. Narrow the path/include filter for exhaustive results.)`,
      )
    }

    if (officeSearch.regexUnsupported) {
      outputLines.push("")
      outputLines.push("(Office-file search skipped: pattern is unsupported by JS RegExp)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: totalMatches,
        truncated,
        officeMatches: officeSearch.matches.length,
      },
      output: outputLines.join("\n"),
    }
  },
})

async function findOfficeMatches(input: {
  searchPath: string
  pattern: string
  include?: string
  abort: AbortSignal
}) {
  let matcher: RegExp
  try {
    matcher = new RegExp(input.pattern)
  } catch {
    return {
      matches: [] as Match[],
      filesSkipped: 0,
      filesCapped: false,
      skipPreview: "",
      regexUnsupported: true,
    }
  }

  const officeFiles: string[] = []
  for await (const relativePath of Ripgrep.files({
    cwd: input.searchPath,
    glob: input.include ? [input.include] : undefined,
    signal: input.abort,
  })) {
    const absolutePath = path.join(input.searchPath, relativePath)
    if (!isOfficeDocumentPath(absolutePath)) continue
    officeFiles.push(absolutePath)
    if (officeFiles.length >= OFFICE_FILE_SCAN_LIMIT) break
  }

  const matches: Match[] = []
  let filesSkipped = 0
  const skippedPaths: string[] = []

  for (const officePath of officeFiles) {
    let converted = ""
    try {
      converted = await convertOfficeToMarkdown(officePath, { abort: input.abort })
    } catch {
      filesSkipped += 1
      if (skippedPaths.length < 3) skippedPaths.push(officePath)
      continue
    }

    const lines = converted.replace(/\r\n/g, "\n").split("\n")
    const stats = Filesystem.stat(officePath)
    const modTime = stats?.mtime.getTime() ?? 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      matcher.lastIndex = 0
      if (!matcher.test(line)) continue
      matches.push({
        path: officePath,
        modTime,
        lineNum: i + 1,
        lineText: line,
      })
    }
  }

  return {
    matches,
    filesSkipped,
    filesCapped: officeFiles.length >= OFFICE_FILE_SCAN_LIMIT,
    skipPreview: skippedPaths.join(", "),
    regexUnsupported: false,
  }
}
