import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"

const DEFAULT_IGNORE = [
  "**/.venv/**",
  "**/.direnv/**",
  "**/.cache/**",
  "**/tmp/**",
  "**/temp/**",
  "**/__pycache__/**",
]

const FOLLOW_WARNING =
  "Following symlinks can scan large or cyclical directories and may spike CPU. Only enable if you need it."

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
      ),
    follow: z.boolean().optional().describe("Follow symlinks (can be expensive); defaults to false"),
  }),
  async execute(params) {
    const root = Instance.worktree
    let search = params.path ?? root
    search = path.isAbsolute(search) ? search : path.resolve(root, search)
    const rel = path.relative(root, search)
    if (rel.startsWith("..")) {
      search = root
    }

    async function searchOnce(options: { maxDepth?: number; timeoutMs?: number; maxFileSize?: string }) {
      const files: { path: string; mtime: number }[] = []
      let truncated = false
      for await (const file of Ripgrep.files({
        cwd: search,
        glob: [params.pattern],
        ignore: DEFAULT_IGNORE,
        maxDepth: options.maxDepth,
        maxFileSize: options.maxFileSize,
        timeoutMs: options.timeoutMs,
        follow: params.follow ?? false,
      })) {
        if (files.length >= limit) {
          truncated = true
          break
        }
        const full = path.resolve(search, file)
        const stats = await Bun.file(full)
          .stat()
          .then((x) => x.mtime.getTime())
          .catch(() => 0)
        files.push({ path: full, mtime: stats })
      }
      files.sort((a, b) => b.mtime - a.mtime)
      return { files, truncated }
    }

    const limit = 100
    const stage1 = await searchOnce({ maxDepth: 8, maxFileSize: "10M", timeoutMs: 4000 })
    const needMore = stage1.files.length < limit && !stage1.truncated
    const stage2 = needMore ? await searchOnce({}) : { files: [], truncated: false }

    const combined = [...stage1.files, ...stage2.files]
    const seen = new Set<string>()
    const deduped = []
    for (const f of combined) {
      if (seen.has(f.path)) continue
      seen.add(f.path)
      deduped.push(f)
    }
    const truncated = stage1.truncated || stage2.truncated
    const files = deduped.slice(0, limit)

    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push("(Results are truncated. Consider using a more specific path or pattern.)")
      }
    }
    if (params.follow) {
      output.push("")
      output.push(FOLLOW_WARNING)
    }

    return {
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
