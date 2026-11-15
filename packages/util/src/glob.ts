import { glob, type GlobOptionsWithFileTypesFalse } from "glob"
import { minimatch } from "minimatch"

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

  export function match(pattern: string, filepath: string): boolean {
    return minimatch(filepath, pattern, { dot: true })
  }
}
