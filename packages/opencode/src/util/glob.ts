import { glob, globSync, type GlobOptions } from "glob"
import { minimatch } from "minimatch"

/**
 * File globbing utility for pattern matching and file discovery.
 *
 * Wraps the glob and minimatch libraries with a simplified interface
 * optimized for the codebase's common use cases.
 */
export namespace Glob {
  /**
   * Options for glob scanning operations.
   */
  export interface Options {
    /** Working directory for relative pattern matching */
    cwd?: string
    /** Return absolute paths instead of relative */
    absolute?: boolean
    /** Include only files, or files and directories ("all") */
    include?: "file" | "all"
    /** Include dotfiles (files starting with .) */
    dot?: boolean
    /** Follow symbolic links */
    symlink?: boolean
  }

  /**
   * Convert our simplified Options to glob library's GlobOptions.
   * @internal
   */
  function toGlobOptions(options: Options): GlobOptions {
    return {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      follow: options.symlink ?? false,
      nodir: options.include !== "all",
    }
  }

  /**
   * Scan for files matching a glob pattern asynchronously.
   *
   * @param pattern - Glob pattern
   * @param options - Scanning options
   * @returns Array of matching file paths
   */
  export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
    return glob(pattern, toGlobOptions(options)) as Promise<string[]>
  }

  /**
   * Scan for files matching a glob pattern synchronously.
   *
   * @param pattern - Glob pattern
   * @param options - Scanning options
   * @returns Array of matching file paths
   */
  export function scanSync(pattern: string, options: Options = {}): string[] {
    return globSync(pattern, toGlobOptions(options)) as string[]
  }

  /**
   * Check if a file path matches a glob pattern.
   *
   * Uses minimatch for pattern matching.
   *
   * @param pattern - Glob pattern to match against
   * @param filepath - File path to check
   * @returns true if the filepath matches the pattern
   */
  export function match(pattern: string, filepath: string): boolean {
    return minimatch(filepath, pattern, { dot: true })
  }
}
