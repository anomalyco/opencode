import { realpathSync } from "fs"
import { Flag } from "@/flag/flag"
import path from "path"
import { normalize as _normalize } from "@opencode-ai/util/path"

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
  export function realpath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return normalize(realpathSync.native(p))
    } catch {
      return p
    }
  }

  /**
   * Normalize a path to use forward slashes on all platforms.
   * On Windows, also convert MSYS and Cygwin style paths to Windows drive letter paths.
   */
  export function normalize(p: string): string {
    if (process.platform !== "win32") return p
    return _normalize(p)
  }

  export function relative(from: string, to: string) {
    return normalize(path.relative(normalize(from), normalize(to)))
  }

  export function resolve(...segments: string[]) {
    return normalize(path.resolve(...segments))
  }

  export function join(...segments: string[]) {
    return normalize(path.join(...segments))
  }

  export function dirname(p: string) {
    return normalize(path.dirname(p))
  }

  export function contains(parent: string, child: string) {
    const path = relative(parent, child)
    return !/^\.\.|.:/.test(path)
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
