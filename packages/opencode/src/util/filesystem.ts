import { exists } from "fs/promises"
import { dirname, join, relative } from "path"

export namespace Filesystem {
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

  export function splitGlob(pattern: string) {
    let current = pattern
    while (true) {
      if (new Bun.Glob(current).scanSync().next().value) {
        // It's a valid path, not a glob
        return { base: current, pattern: "" }
      }
      const parent = dirname(current)
      if (parent === current || parent === ".") {
        // We reached the root or current directory without finding a non-glob base
        // This is a bit simplistic but works for common cases
        return { base: ".", pattern }
      }
      // Check if the parent part contains glob characters
      if (/[*?{\[]/.test(parent)) {
        current = parent
        continue
      }
      // Parent is a safe base directory
      return { base: parent, pattern: relative(parent, pattern) }
    }
  }
}
