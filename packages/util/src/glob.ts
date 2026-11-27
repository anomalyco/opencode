import { glob, type GlobOptionsWithFileTypesFalse } from "glob"
import { Minimatch, minimatch } from "minimatch"

export namespace Glob {
  export interface Options {
    cwd?: string
    absolute?: boolean
    include?: "file" | "all"
    dot?: boolean
    symlink?: boolean
    ignore?: string[]
  }

  function toGlobOptions(options: Options): GlobOptionsWithFileTypesFalse {
    return {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      follow: options.symlink ?? false,
      nodir: options.include !== "all",
      ignore: options.ignore,
    }
  }

  export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
    return glob(pattern, toGlobOptions(options))
  }

  export function match(pattern: string, filepath: string, options: { dot?: boolean } = {}): boolean {
    return minimatch(filepath, pattern, { dot: options.dot ?? true })
  }

  /** `match` for one pattern, compiled on first use and reused for every later path. */
  export function matcher(pattern: string, options: { dot?: boolean } = {}): (filepath: string) => boolean {
    let compiled: Minimatch | undefined
    return (filepath) => (compiled ??= new Minimatch(pattern, { dot: options.dot ?? true })).match(filepath)
  }
}
