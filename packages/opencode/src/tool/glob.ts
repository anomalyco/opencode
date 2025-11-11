import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { conditionalEncode } from "../util/toon"
import { Config } from "../config/config"

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
  }),
  async execute(params) {
    let search = params.path ?? Instance.directory
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)

    const limit = 100
    const files: Array<{ path: string; mtime: number }> = []
    let truncated = false
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
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
      files.push({
        path: full,
        mtime: stats,
      })
    }
    files.sort((a, b) => b.mtime - a.mtime)

    const config = await Config.get()
    const output = conditionalEncode(
      files,
      (data) => {
        const fileList = data as Array<{ path: string; mtime: number }>
        const lines: string[] = []
        if (fileList.length === 0) lines.push("No files found")
        if (fileList.length > 0) {
          lines.push(...fileList.map((f) => f.path))
          if (truncated) {
            lines.push("")
            lines.push("(Results are truncated. Consider using a more specific path or pattern.)")
          }
        }
        return lines.join("\n")
      },
      config.ai?.useToonEncoding,
    )

    return {
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output,
    }
  },
})
