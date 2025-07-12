import path from "path"

export const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

export const DEFAULT_LIMIT = 100

export interface FileInfo {
  path: string
  mtime: number
}

export interface FileToolResult {
  title: string
  metadata: {
    count: number
    truncated: boolean
  }
  output: string
}

export async function batchFileStat(filePaths: string[]): Promise<FileInfo[]> {
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

export function resolvePath(searchPath: string | undefined, cwd: string): string {
  const search = searchPath ?? cwd
  return path.isAbsolute(search) ? search : path.resolve(cwd, search)
}

export function shouldIgnoreFile(file: string, ignorePatterns: string[]): boolean {
  return IGNORE_PATTERNS.some((p) => new Bun.Glob(p).match(file)) ||
         ignorePatterns.some((pattern) => new Bun.Glob(pattern).match(file))
}

export function formatTruncationMessage(truncated: boolean): string[] {
  if (!truncated) return []
  return ["", "(Results are truncated. Consider using a more specific path or pattern.)"]
}