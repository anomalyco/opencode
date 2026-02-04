import { realpathSync } from "fs"
import { dirname, join, relative } from "path"

export namespace Filesystem {
  export const exists = (p: string) =>
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

  /**
   * Lexical check only - does not resolve symlinks.
   * Use containsSecure for security-critical path validation.
   */
  export function contains(parent: string, child: string) {
    return !relative(parent, child).startsWith("..")
  }

  /**
   * Secure path containment check that resolves symlinks and handles Windows drives.
   * Returns false if:
   * - The resolved child path escapes the parent directory via symlinks
   * - On Windows, the paths are on different drives
   * - The path resolution fails for any reason
   */
  export function containsSecure(parent: string, child: string): boolean {
    try {
      // On Windows, check if paths are on different drives
      if (process.platform === "win32") {
        const parentDrive = parent.match(/^([a-zA-Z]:)/)?.[1]?.toUpperCase()
        const childDrive = child.match(/^([a-zA-Z]:)/)?.[1]?.toUpperCase()
        if (parentDrive && childDrive && parentDrive !== childDrive) {
          return false
        }
      }

      // Resolve symlinks to get canonical paths
      const resolvedParent = realpathSync(parent)
      const resolvedChild = realpathSync(child)

      // Check containment with resolved paths
      return !relative(resolvedParent, resolvedChild).startsWith("..")
    } catch {
      // If realpath fails (e.g., path doesn't exist yet), fall back to lexical check
      // but be conservative - return false if we can't verify
      return false
    }
  }

  /**
   * Async version of containsSecure for non-blocking operations.
   */
  export async function containsSecureAsync(parent: string, child: string): Promise<boolean> {
    try {
      const { realpath } = await import("fs/promises")

      // On Windows, check if paths are on different drives
      if (process.platform === "win32") {
        const parentDrive = parent.match(/^([a-zA-Z]:)/)?.[1]?.toUpperCase()
        const childDrive = child.match(/^([a-zA-Z]:)/)?.[1]?.toUpperCase()
        if (parentDrive && childDrive && parentDrive !== childDrive) {
          return false
        }
      }

      const resolvedParent = await realpath(parent)
      const resolvedChild = await realpath(child)

      return !relative(resolvedParent, resolvedChild).startsWith("..")
    } catch {
      return false
    }
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
