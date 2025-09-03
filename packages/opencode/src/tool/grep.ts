import z from "zod/v4"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    const searchPath = params.path || Instance.directory

    const rgPath = await Ripgrep.filepath()
    const args = ["--json", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const output = await new Response(proc.stdout).text()
    const errorOutput = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode === 1) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const lines = output.trim().split("\n")
    const fileGroups = new Map()

    for (const line of lines) {
      if (!line) continue

      let json
      try {
        json = JSON.parse(line)
      } catch {
        continue
      }

      if (json.type !== "match") continue

      const data = json.data
      const filePath = data.path.text
      const lineNum = data.line_number
      const lineText = data.lines.text.trim()

      if (!fileGroups.has(filePath)) {
        const file = Bun.file(filePath)
        const stats = await file.stat().catch(() => null)
        if (!stats) continue

        fileGroups.set(filePath, {
          modTime: stats.mtime.getTime(),
          matches: [],
        })
      }

      fileGroups.get(filePath).matches.push({
        lineNum,
        lineText,
      })
    }

    const sortedFiles = Array.from(fileGroups.entries()).sort(([, a], [, b]) => b.modTime - a.modTime)

    // Count total matches for limit and truncation
    let totalMatches = 0
    for (const [, fileData] of sortedFiles) {
      totalMatches += fileData.matches.length
    }

    const limit = 100
    const truncated = totalMatches > limit

    if (totalMatches === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${totalMatches} matches`]
    let matchesOutput = 0

    for (const [filePath, fileData] of sortedFiles) {
      if (matchesOutput >= limit) break

      outputLines.push("")
      outputLines.push(`${filePath}:`)

      for (const match of fileData.matches) {
        if (matchesOutput >= limit) break
        outputLines.push(`  Line ${match.lineNum}: ${match.lineText}`)
        matchesOutput++
      }
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
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
