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
   * Check if a path is within a parent directory, with protection against:
   * - Symlink escapes: Resolves symlinks to their real paths
   * - Cross-drive paths on Windows: Checks drive letters match
   * Returns true if child is within parent, false otherwise.
   */
  export function contains(parent: string, child: string): boolean {
    try {
      const realParent = realpathSync(parent)
      const realChild = realpathSync(child)

      if (process.platform === "win32") {
        const parentDrive = realParent.split(":")[0]?.toLowerCase()
        const childDrive = realChild.split(":")[0]?.toLowerCase()
        if (parentDrive !== childDrive) {
          return false
        }
      }

      const rel = relative(realParent, realChild)
      return !rel.startsWith("..") && rel !== ".."
    } catch {
      const rel = relative(parent, child)
      return !rel.startsWith("..")
    }
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search).catch(() => false)) result.push(search)
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
        if (await exists(search).catch(() => false)) yield search
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
