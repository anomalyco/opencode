import { lstatSync, readlinkSync, realpathSync } from "fs"
import { exists } from "fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "path"

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
   * Lexical containment check - does NOT resolve symlinks.
   * Use containsResolved() when the child path may be a symlink pointing outside.
   */
  export function contains(parent: string, child: string) {
    return !relative(parent, child).startsWith("..")
  }

  /**
   * Containment check with symlink resolution.
   * Returns true only if the resolved child path is within the resolved parent.
   * Returns false if the path is a symlink pointing outside, even if broken.
   *
   * Note: There is an inherent TOCTOU (time-of-check-time-of-use) race condition
   * between this check and actual file operations. This is acceptable for the
   * threat model of protecting against malicious symlinks in user-controlled
   * directories, but not against active attackers with concurrent write access.
   */
  export function containsResolved(parent: string, child: string): boolean {
    try {
      const resolvedParent = realpathSync(parent)

      // First, check if the child path is a symlink
      try {
        const stats = lstatSync(child)
        if (stats.isSymbolicLink()) {
          // It's a symlink - check where it points
          const linkTarget = readlinkSync(child)
          const absoluteTarget = isAbsolute(linkTarget) ? linkTarget : resolve(dirname(child), linkTarget)

          // Try to resolve the full path (handles symlink chains)
          try {
            const resolvedChild = realpathSync(child)
            return !relative(resolvedParent, resolvedChild).startsWith("..")
          } catch {
            // Broken symlink - check if target would be inside parent.
            // relative() normalizes paths, so traversal attempts like
            // /project/../../../etc are correctly detected as escaping.
            return !relative(resolvedParent, absoluteTarget).startsWith("..")
          }
        }
      } catch {
        // lstatSync failed - path doesn't exist at all (not even as broken symlink)
      }

      // Not a symlink - try to resolve normally
      try {
        const resolvedChild = realpathSync(child)
        return !relative(resolvedParent, resolvedChild).startsWith("..")
      } catch {
        // Path doesn't exist - check parent directory
        const childDir = dirname(child)
        if (childDir === child) return false // root directory

        try {
          const resolvedChildDir = realpathSync(childDir)
          return !relative(resolvedParent, resolvedChildDir).startsWith("..")
        } catch {
          // Parent directory also doesn't exist - fall back to lexical check.
          // This is safe because symlinks can't exist if the parent doesn't.
          return contains(parent, child)
        }
      }
    } catch {
      // Parent doesn't exist or can't be resolved - deny access
      return false
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
