import z from "zod"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE_LENGTH = 2000
const STAT_CONCURRENCY = 100 // 并发控制

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

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.abort,
    })

    const outputText = await new Response(proc.stdout).text()
    const errorOutput = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches)
    if (exitCode === 1 || (exitCode === 2 && !outputText.trim())) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found matching the pattern.",
      }
    }

    if (exitCode !== 0 && exitCode !== 2) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const hasErrors = exitCode === 2
    const lines = outputText.trim().split(/\r?\n/)
    
    // 解析结果
    const rawMatches = lines
      .map(line => {
        if (!line) return null
        const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
        if (!filePath || !lineNumStr || lineTextParts.length === 0) return null
        return {
          filePath,
          lineNum: parseInt(lineNumStr, 10),
          lineText: lineTextParts.join("|")
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)

    // 并发获取文件状态
    const matches: any[] = []
    for (let i = 0; i < rawMatches.length; i += STAT_CONCURRENCY) {
      const batch = rawMatches.slice(i, i + STAT_CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(async (m) => {
          const file = Bun.file(m.filePath)
          const stats = await file.stat().catch(() => null)
          if (!stats) return null
          return {
            ...m,
            modTime: stats.mtime.getTime()
          }
        })
      )
      matches.push(...batchResults.filter((m): m is NonNullable<typeof m> => m !== null))
    }

    // 按修改时间降序排列
    matches.sort((a, b) => b.modTime - a.modTime)

    const totalMatches = matches.length
    const SOFT_LIMIT = 200 // 展示上限
    const truncated = totalMatches > SOFT_LIMIT
    const finalMatches = matches.slice(0, SOFT_LIMIT)

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found matching the pattern.",
      }
    }

    const outputLines: string[] = []
    const searchIsBase = searchPath === Instance.worktree

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.filePath) {
        if (currentFile !== "") outputLines.push("")
        currentFile = match.filePath
        const displayPath = searchIsBase 
          ? path.relative(Instance.worktree, match.filePath) 
          : match.filePath
        outputLines.push(`${displayPath}:`)
      }
      
      const truncatedLineText = match.lineText.length > MAX_LINE_LENGTH 
        ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." 
        : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push(`... and ${totalMatches - SOFT_LIMIT} more matches. Consider using a more specific path or pattern.`)
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: totalMatches,
        displayed: finalMatches.length,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
