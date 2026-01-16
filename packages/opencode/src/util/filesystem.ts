import { realpathSync } from "fs"
import { dirname, join, relative } from "path"

export namespace Filesystem {
  export interface SanitizeResult {
    path: string
    warnings: string[]
  }

  /**
   * Sanitize a path by removing problematic characters.
   * Returns the sanitized path and any warnings about what was fixed.
   */
  export function sanitizePath(p: string): SanitizeResult {
    const warnings: string[] = []
    let result: string = p

    // Check for null bytes
    if (result.includes("\0")) {
      warnings.push("Path contains null bytes")
      result = result.replace(/\0/g, "")
    }

    // Check for leading whitespace
    if (result !== result.trimStart()) {
      warnings.push("Path has leading whitespace")
      result = result.trimStart()
    }

    // Check for trailing whitespace
    if (result !== result.trimEnd()) {
      warnings.push("Path has trailing whitespace")
      result = result.trimEnd()
    }

    // Check if empty after sanitization
    if (!result) {
      warnings.push("Path is empty after sanitization")
    }

    return { path: result, warnings }
  }

  export const exists = (p: string): Promise<boolean> =>
    Bun.file(p)
      .stat()
      .then(() => true)
      .catch(() => false)

  export const isDir = (p: string) =>
    Bun.file(p)
      .stat()
      .then((s) => s.isDirectory())
      .catch(() => false)
  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }
  export function overlaps(a: string, b: string) {
    const relA = relative(a, b)
    const relB = relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    return !relative(parent, child).startsWith("..")
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({
          cwd: current,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          result.push(match)
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
