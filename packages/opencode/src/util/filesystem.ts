import { realpathSync } from "fs"
import { exists } from "fs/promises"
import { dirname, join, relative } from "path"

export namespace Filesystem {
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

  /**
   * Check if a relative path is contained (doesn't escape via .. or cross-drive)
   */
  function isContained(rel: string): boolean {
    // On Windows, check for cross-drive paths (e.g., "D:\..." from "C:\...")
    if (process.platform === "win32" && /^[A-Za-z]:/.test(rel)) {
      return false
    }
    return !rel.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    // Try to resolve each path individually to prevent symlink escapes.
    // Use resolved paths when available for maximum security.
    let resolvedParent = parent
    let resolvedChild = child

    try {
      resolvedParent = realpathSync(parent)
    } catch {
      // Parent doesn't exist or can't be resolved, use original
    }

    try {
      resolvedChild = realpathSync(child)
    } catch {
      // Child doesn't exist yet (common for new files), use original
      // But if parent was resolved, still use resolved parent for safety
    }

    // Use the best available paths (resolved when possible)
    const rel = relative(resolvedParent, resolvedChild)
    return isContained(rel)
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
