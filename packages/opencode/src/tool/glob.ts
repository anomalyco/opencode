import { z } from "zod"
import path from "path"
import { Tool } from "./tool"
import { App } from "../app/app"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"

const DEFAULT_LIMIT = 100

interface FileInfo {
  path: string
  mtime: number
}

async function batchFileStat(filePaths: string[]): Promise<FileInfo[]> {
  const BATCH_SIZE = 50
  const results: FileInfo[] = []
  
  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE)
    const batchPromises = batch.map(async (filePath) => {
      try {
        const stats = await Bun.file(filePath).stat()
        return {
          path: filePath,
          mtime: stats.mtime.getTime(),
        }
      } catch (error) {
        console.warn(`Failed to stat file ${filePath}:`, error)
        return {
          path: filePath,
          mtime: 0,
        }
      }
    })
    
    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
  }
  
  return results
}

function resolvePath(searchPath: string | undefined, cwd: string): string {
  const search = searchPath ?? cwd
  return path.isAbsolute(search) ? search : path.resolve(cwd, search)
}

function formatTruncationMessage(truncated: boolean): string[] {
  if (!truncated) return []
  return ["", "(Results are truncated. Consider using a more specific path or pattern.)"]
}

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
