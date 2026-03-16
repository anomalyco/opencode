import { glob, globSync, type GlobOptions } from "glob"
import { minimatch } from "minimatch"

/**
 * Provides file pattern matching and scanning utilities.
 *
 * This namespace wraps the `glob` and `minimatch` libraries to offer
 * a simplified interface for finding files matching glob patterns.
 * Supports both async and sync scanning, with options for controlling
 * behavior like following symlinks and including dotfiles.
 *
 * @example
 * ```typescript
 * // Find all TypeScript files
 * const files = await Glob.scan("**/*.ts", { cwd: "./src" })
 *
 * // Check if a file matches a pattern
 * const isMatch = Glob.match("**/*.test.ts", "src/utils.test.ts")
 * ```
 */
export namespace Glob {
  /**
   * Options for glob scanning operations.
   */
  export interface Options {
    /** The current working directory for relative pattern matching */
    cwd?: string
    /** Return absolute paths instead of relative paths */
    absolute?: boolean
    /** Filter results to include only files or all entries */
    include?: "file" | "all"
    /** Include dotfiles (files starting with .) in results */
    dot?: boolean
    /** Follow symbolic links when scanning directories */
    symlink?: boolean
  }

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
   * Asynchronously scans for files matching the given pattern.
   *
   * Searches the filesystem for files matching the glob pattern and
   * returns an array of matching file paths.
   *
   * @param pattern - The glob pattern to match (e.g., "**/*.ts")
   * @param options - Configuration options for the scan
   * @returns A promise resolving to an array of matching file paths
   * @example
   * ```typescript
   * const tsFiles = await Glob.scan("**/*.ts", { cwd: "./src" })
   * console.log(`Found ${tsFiles.length} TypeScript files`)
   * ```
   */
  export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
    return glob(pattern, toGlobOptions(options)) as Promise<string[]>
  }

  /**
   * Synchronously scans for files matching the given pattern.
   *
   * Searches the filesystem for files matching the glob pattern and
   * returns an array of matching file paths. Blocks until complete.
   *
   * @param pattern - The glob pattern to match (e.g., "**/*.ts")
   * @param options - Configuration options for the scan
   * @returns An array of matching file paths
   * @example
   * ```typescript
   * const configFiles = Glob.scanSync("**/*.config.ts")
   * ```
   */
  export function scanSync(pattern: string, options: Options = {}): string[] {
    return globSync(pattern, toGlobOptions(options)) as string[]
  }

  /**
   * Tests if a file path matches a glob pattern.
   *
   * Uses minimatch to check if the given filepath matches the pattern.
   * Supports standard glob syntax including wildcards and character classes.
   *
   * @param pattern - The glob pattern to match against
   * @param filepath - The file path to test
   * @returns True if the filepath matches the pattern, false otherwise
   * @example
   * ```typescript
   * Glob.match("**/*.test.ts", "src/utils.test.ts") // Returns: true
   * Glob.match("**/*.js", "src/app.ts") // Returns: false
   * ```
   */
  export function match(pattern: string, filepath: string): boolean {
    return minimatch(filepath, pattern, { dot: true })
  }
}
