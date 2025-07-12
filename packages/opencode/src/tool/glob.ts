import { z } from "zod"
import path from "path"
import { Tool } from "./tool"
import { App } from "../app/app"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { batchFileStat, resolvePath, formatTruncationMessage, DEFAULT_LIMIT } from "../util/fs"

export const GlobTool = Tool.define({
  id: "glob",
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
    const app = App.info()
    const search = resolvePath(params.path, app.path.cwd)

    const filePaths = []
    let truncated = false
    
    for (const file of await Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
    })) {
      if (filePaths.length >= DEFAULT_LIMIT) {
        truncated = true
        break
      }
      filePaths.push(path.resolve(search, file))
    }

    const files = await batchFileStat(filePaths)
    files.sort((a, b) => b.mtime - a.mtime)

    const output = []
    if (files.length === 0) {
      output.push("No files found")
    } else {
      output.push(...files.map((f) => f.path))
      output.push(...formatTruncationMessage(truncated))
    }

    return {
      title: path.relative(app.path.root, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
