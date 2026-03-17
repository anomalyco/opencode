import { sep } from "node:path"
import { Glob } from "../util/glob"

/**
 * File ignore patterns and matching utilities.
 *
 * Provides patterns for common files and directories that should be ignored
 * during file operations, such as node_modules, build outputs, and VCS directories.
 *
 * @example
 * ```typescript
 * const shouldIgnore = FileIgnore.match("node_modules/foo/bar")
 * const patterns = FileIgnore.PATTERNS
 * ```
 */
export namespace FileIgnore {
  const FOLDERS = new Set([
    "node_modules",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    ".turbo",
    ".output",
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ])

  const FILES = [
    "**/*.swp",
    "**/*.swo",

    "**/*.pyc",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",
  ]

  export const PATTERNS = [...FILES, ...FOLDERS]

  /**
   * Checks if a file path matches any ignore patterns.
   *
   * Matches against both built-in patterns (node_modules, build outputs, etc.)
   * and any extra patterns provided in options.
   *
   * @param filepath - The file path to check
   * @param opts - Optional configuration
   * @param opts.extra - Additional glob patterns to match against
   * @param opts.whitelist - Patterns that should not be ignored (takes precedence)
   * @returns True if the file should be ignored
   */
  export function match(
    filepath: string,
    opts?: {
      extra?: string[]
      whitelist?: string[]
    },
  ) {
    for (const pattern of opts?.whitelist || []) {
      if (Glob.match(pattern, filepath)) return false
    }

    const parts = filepath.split(/[/\\]/)
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
    }

    const extra = opts?.extra || []
    for (const pattern of [...FILES, ...extra]) {
      if (Glob.match(pattern, filepath)) return true
    }

    return false
  }
}
