import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"

// Concurrency limit for stat calls to avoid OS overhead
const STAT_CONCURRENCY = 100

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against (e.g. '**/*.js', 'src/**/*.ts')"),
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. Defaults to the current working directory.`,
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
      },
    })

    let search = params.path ?? Instance.directory
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)
    await assertExternalDirectory(ctx, search, { kind: "directory" })

    const results: string[] = []
    
    // 1. Get all files from ripgrep as fast as possible
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
      signal: ctx.abort,
    })) {
      results.push(file)
    }

    if (results.length === 0) {
      return {
        title: path.relative(Instance.worktree, search) || ".",
        metadata: {
          total: 0,
          displayed: 0,
          truncated: false,
          count: 0, // Maintain backward compatibility for UI
        },
        output: "No files found matching the pattern.",
      }
    }

    // 2. High-performance Parallel Stat with Concurrency Control
    // We only stat if it's a reasonable amount, or we take the most relevant ones.
    // However, the user said "no limits", so we'll process all, but with batching.
    const baseDir = Instance.directory
    const fileInfos: { path: string; mtime: number }[] = []
    
    // Optimization: Pre-calculate constants
    const searchIsBase = search === baseDir

    const processBatch = async (batch: string[]) => {
      return Promise.all(
        batch.map(async (file) => {
          const full = path.resolve(search, file)
          const rel = searchIsBase ? file : path.relative(baseDir, full)
          try {
            const stats = await Bun.file(full).stat()
            return { path: rel, mtime: stats.mtime.getTime() }
          } catch {
            return { path: rel, mtime: 0 }
          }
        })
      )
    }

    // Run stats in controlled batches
    for (let i = 0; i < results.length; i += STAT_CONCURRENCY) {
      const batch = results.slice(i, i + STAT_CONCURRENCY)
      const batchResults = await processBatch(batch)
      fileInfos.push(...batchResults)
    }

    // 3. Sort by mtime descending
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    // 4. Smart Output Construction
    const output = []
    const total = fileInfos.length
    
    // If results are massive, we provide a structured summary to keep it "usable"
    // but we don't truncate unless it's absolutely necessary for token limits (> 1000)
    const SOFT_LIMIT = 500
    const displayedFiles = fileInfos.slice(0, SOFT_LIMIT)

    if (total > SOFT_LIMIT) {
      output.push(`Found ${total} matches. Showing the ${SOFT_LIMIT} most recently modified files:`)
      output.push("")
    } else {
      output.push(`Found ${total} matches:`)
      output.push("")
    }

    // Grouping logic for the distribution summary
    const dirGroups = new Map<string, number>()
    fileInfos.forEach(f => {
      const dir = f.path.split(/[\\\/]/)[0] || "."
      dirGroups.set(dir, (dirGroups.get(dir) || 0) + 1)
    })

    if (dirGroups.size > 1 && total > 50) {
      output.push("Matches distribution by top-level directory:")
      const sortedDirs = [...dirGroups.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
      sortedDirs.forEach(([dir, count]) => output.push(`- ${dir}/: ${count} files`))
      if (dirGroups.size > 8) output.push(`- ... and ${dirGroups.size - 8} more directories`)
      output.push("")
    }

    output.push(...displayedFiles.map(f => f.path))

    if (total > SOFT_LIMIT) {
      output.push("")
      output.push(`... and ${total - SOFT_LIMIT} more files were omitted for readability.`)
      output.push("Hint: Use a more specific sub-path or pattern if you need to find something else.")
    }

    return {
      title: path.relative(Instance.worktree, search) || ".",
      metadata: {
        total,
        displayed: displayedFiles.length,
        truncated: total > SOFT_LIMIT,
        count: total, // Maintain backward compatibility for UI
      },
      output: output.join("\n"),
    }
  },
})
