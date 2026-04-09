import path from "path"
import { Effect } from "effect"
import { minimatch } from "minimatch"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

export namespace ContextMap {
  function excludePatterns(): Effect.Effect<string[], never, never> {
    return Effect.promise(() => Config.get().then((config) => config.context?.exclude ?? [])).pipe(
      Effect.catch(() => Effect.succeed([])),
    )
  }

  function includePatterns(): Effect.Effect<string[], never, never> {
    return Effect.promise(() => Config.get().then((config) => config.context?.include ?? [])).pipe(
      Effect.catch(() => Effect.succeed([])),
    )
  }

  function matches(filepath: string, patterns: string[]): boolean {
    const basename = path.basename(filepath)
    const relative = path.relative(Instance.directory, filepath)

    for (const pattern of patterns) {
      if (minimatch(basename, pattern)) return true
      if (minimatch(relative, pattern)) return true
      if (minimatch(filepath, pattern)) return true
    }
    return false
  }

  export function isIgnored(filepath: string): Effect.Effect<boolean, never, never> {
    return excludePatterns().pipe(
      Effect.map((patterns) => {
        if (patterns.length === 0) return false
        return matches(filepath, patterns)
      }),
    )
  }

  export function filterPaths(paths: Set<string>): Effect.Effect<Set<string>, never, never> {
    return excludePatterns().pipe(
      Effect.map((patterns) => {
        if (patterns.length === 0) return paths
        const result = new Set<string>()
        for (const p of paths) {
          if (!matches(p, patterns)) {
            result.add(p)
          }
        }
        return result
      }),
    )
  }

  export function isExternalDirIgnored(dirName: string): Effect.Effect<boolean, never, never> {
    return excludePatterns().pipe(
      Effect.map((patterns) => {
        if (patterns.length === 0) return false
        for (const pattern of patterns) {
          if (minimatch(dirName, pattern)) return true
          const segments = pattern.split("/")
          for (const segment of segments) {
            if (segment !== "*" && minimatch(dirName, segment)) return true
          }
        }
        return false
      }),
    )
  }

  export function contextPatterns(): Effect.Effect<string[], never, never> {
    return includePatterns()
  }
}
