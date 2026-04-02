import path from "path"
import os from "os"
import { realpathSync } from "fs"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "path-validation" })

/**
 * Shell expansion patterns that could allow arbitrary path access.
 * These should be blocked in tool inputs.
 */
const SHELL_EXPANSION_PATTERNS: RegExp[] = [
  // Unix variable expansion: $VAR, ${VAR}
  /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/,
  // Command substitution: $(cmd) or `cmd`
  /\$\([^)]*\)/,
  /`[^`]*`/,
  // Windows variable expansion: %VAR%
  /%[A-Za-z_][A-Za-z0-9_]*%/,
  // Home directory expansion: ~ or ~/  (but not in the middle of a word)
  /(?:^|[/\\])~(?:[/\\]|$)/,
  // Wildcards that could match outside directory: **/*. (but allow simple * as glob)
  /\*\*[/\\]/,
]

/**
 * Result of path validation.
 */
export interface PathValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  /** Resolved path (after symlink resolution if checked) */
  resolvedPath?: string
  /** Whether the path is a symlink */
  isSymlink?: boolean
  /** Whether the path is outside working directory */
  outsideWorkingDirectory?: boolean
  /** Whether the path is in a dangerous directory */
  dangerousDirectory?: string | null
}

/**
 * Dangerous directories that should always require explicit approval.
 * These are system-critical or user-critical paths.
 */
const DANGEROUS_DIRECTORIES: Array<{ pattern: RegExp; description: string }> = [
  // Git directory
  { pattern: /(?:^|[\/\\])\.git(?:[\/\\]|$)/i, description: ".git directory" },
  // Shell config files
  { pattern: /(?:^|[\/\\])\.bashrc$/i, description: ".bashrc" },
  { pattern: /(?:^|[\/\\])\.zshrc$/i, description: ".zshrc" },
  { pattern: /(?:^|[\/\\])\.profile$/i, description: ".profile" },
  { pattern: /(?:^|[\/\\])\.bash_profile$/i, description: ".bash_profile" },
  { pattern: /(?:^|[\/\\])\.zprofile$/i, description: ".zprofile" },
  { pattern: /(?:^|[\/\\])\.config[\/\\]fish[\/\\]config\.fish$/i, description: "fish config" },
  // SSH keys
  { pattern: /(?:^|[\/\\])\.ssh[\/\\]/i, description: ".ssh directory" },
  // Environment files
  { pattern: /(?:^|[\/\\])\.env$/i, description: ".env file" },
  { pattern: /(?:^|[\/\\])\.env\.\w+$/i, description: ".env.* file" },
]

/**
 * Check if a path contains shell expansion patterns.
 */
export function hasShellExpansion(inputPath: string): { has: boolean; pattern: string | null } {
  for (const pattern of SHELL_EXPANSION_PATTERNS) {
    if (pattern.test(inputPath)) {
      return { has: true, pattern: pattern.source }
    }
  }
  return { has: false, pattern: null }
}

/**
 * Check if a path contains traversal sequences (../).
 * This checks for `..` as a path segment, not as part of a filename.
 */
export function hasTraversal(inputPath: string): boolean {
  // Split by path separators and check for `..` segments
  const segments = inputPath.split(/[/\\]/)
  return segments.includes("..")
}

/**
 * Check if a path is within a dangerous directory.
 */
export function isDangerousDirectory(inputPath: string): string | null {
  for (const { pattern, description } of DANGEROUS_DIRECTORIES) {
    if (pattern.test(inputPath)) {
      return description
    }
  }
  return null
}

/**
 * Resolve symlinks in a path.
 * Returns the resolved path, or the original path if resolution fails.
 */
export async function resolveSymlinks(
  inputPath: string,
  workingDirectory?: string,
): Promise<{ resolved: string; isSymlink: boolean }> {
  const cwd = workingDirectory ?? Instance.directory
  try {
    const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath)

    // Use realpathSync to resolve symlinks
    const resolved = realpathSync.native(absolutePath) as string

    // If realpath differs from the original, it's a symlink (or path doesn't exist)
    const isSymlink = resolved !== absolutePath

    return { resolved, isSymlink }
  } catch (error) {
    // If realpath fails (e.g., path doesn't exist), return the normalized path
    log.info("symlink resolution failed", { path: inputPath, error: String(error) })
    return {
      resolved: path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath),
      isSymlink: false,
    }
  }
}

/**
 * Validate a path for use in file tools.
 *
 * Checks:
 * 1. Shell expansion patterns (blocked)
 * 2. Path traversal sequences (validated after resolution)
 * 3. Symlink resolution (to prevent escapes)
 * 4. Working directory containment
 * 5. Dangerous directory protection
 *
 * @param inputPath - The path to validate
 * @param options - Validation options
 * @returns PathValidationResult with validation status and any errors/warnings
 */
export async function validatePath(
  inputPath: string,
  options?: {
    /** Check for symlinks (default: true) */
    resolveSymlinks?: boolean
    /** Enforce working directory containment (default: true) */
    enforceWorkingDirectory?: boolean
    /** Check dangerous directories (default: true) */
    checkDangerousDirectories?: boolean
    /** Working directory to validate against (default: Instance.directory) */
    workingDirectory?: string
  },
): Promise<PathValidationResult> {
  const {
    resolveSymlinks: checkSymlinks = true,
    enforceWorkingDirectory = true,
    checkDangerousDirectories = true,
    workingDirectory,
  } = options ?? {}

  // Get working directory from options or Instance
  const cwd = workingDirectory ?? Instance.directory

  const errors: string[] = []
  const warnings: string[] = []

  // 1. Check for shell expansion patterns
  const expansion = hasShellExpansion(inputPath)
  if (expansion.has) {
    errors.push(
      `Path contains shell expansion pattern: ${expansion.pattern}. This is not allowed for security reasons.`,
    )
  }

  // 2. Check for traversal sequences before resolution
  // Note: We'll also check after resolution for symlink-based traversal
  if (hasTraversal(inputPath)) {
    // Don't error yet - will validate after resolution
    warnings.push("Path contains '..' sequences. Will validate final resolved path.")
  }

  // 3. Resolve symlinks if requested
  let resolvedPath = inputPath
  let isSymlink = false

  if (checkSymlinks && errors.length === 0) {
    const resolved = await resolveSymlinks(inputPath, workingDirectory)
    resolvedPath = resolved.resolved
    isSymlink = resolved.isSymlink

    if (isSymlink) {
      log.info("path is symlink, resolved", { original: inputPath, resolved: resolvedPath })
    }
  }

  // 4. Check working directory containment
  let outsideWorkingDirectory = false
  if (enforceWorkingDirectory && errors.length === 0) {
    const absoluteResolved = path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(cwd, resolvedPath)

    // Check if path is within working directory
    // Use Instance.containsPath if available, otherwise do a simple path comparison
    let isWithin = false
    try {
      isWithin = Instance.containsPath(absoluteResolved)
    } catch {
      // If Instance context not available, do simple prefix check
      const normalizedResolved = path.normalize(absoluteResolved)
      const normalizedCwd = path.normalize(cwd)
      isWithin = normalizedResolved.startsWith(normalizedCwd + path.sep) || normalizedResolved === normalizedCwd
    }

    outsideWorkingDirectory = !isWithin
    if (outsideWorkingDirectory) {
      // For paths outside working directory, we issue a warning but don't block
      // The permission system will require explicit approval
      warnings.push(`Path resolves outside working directory: ${absoluteResolved}`)
    }
  }

  // 5. Check dangerous directories
  let dangerousDirectory: string | null = null
  if (checkDangerousDirectories && errors.length === 0) {
    dangerousDirectory = isDangerousDirectory(resolvedPath)
    if (dangerousDirectory) {
      // Dangerous directories always require explicit approval
      warnings.push(`Path targets a protected location: ${dangerousDirectory}`)
    }
  }

  // If we found .. in the original path and resolved path is still outside
  // working directory after resolution, that's an error
  if (hasTraversal(inputPath) && !isWithinWorkingDirectorySync(resolvedPath, workingDirectory)) {
    errors.push(`Path traversal would escape working directory. Resolved path: ${resolvedPath}`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedPath,
    isSymlink,
    outsideWorkingDirectory,
    dangerousDirectory,
  }
}

/**
 * Synchronous version of working directory check.
 * Used when we need a quick check without async resolution.
 */
function isWithinWorkingDirectorySync(inputPath: string, workingDirectory?: string): boolean {
  const cwd = workingDirectory ?? Instance.directory
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath)

  // Try Instance.containsPath first, fall back to simple prefix check
  try {
    return Instance.containsPath(absolutePath)
  } catch {
    // If Instance context not available, do simple prefix check
    const normalizedPath = path.normalize(absolutePath)
    const normalizedCwd = path.normalize(cwd)
    return normalizedPath.startsWith(normalizedCwd + path.sep) || normalizedPath === normalizedCwd
  }
}

/**
 * Validate a path and throw on error.
 * Convenience function for when you want exceptions instead of result objects.
 */
export async function validatePathOrThrow(
  inputPath: string,
  options?: Parameters<typeof validatePath>[1],
): Promise<string> {
  const result = await validatePath(inputPath, options)
  if (!result.valid) {
    throw new Error(`Path validation failed: ${result.errors.join("; ")}`)
  }
  return result.resolvedPath ?? inputPath
}

/**
 * Check if a path is safe to auto-approve (not in a dangerous directory).
 * Returns true if the path is safe, false if it's in a protected location.
 */
export function isPathAutoApprovable(inputPath: string): boolean {
  // Check for dangerous directories
  const dangerous = isDangerousDirectory(inputPath)
  if (dangerous) {
    return false
  }

  // Check for shell expansions
  if (hasShellExpansion(inputPath).has) {
    return false
  }

  // Paths with traversal are not auto-approved
  if (hasTraversal(inputPath)) {
    return false
  }

  return true
}

/**
 * Get a description of why a path would not be auto-approved.
 */
export function getPathApprovalReason(inputPath: string): string | null {
  const dangerous = isDangerousDirectory(inputPath)
  if (dangerous) {
    return `Path targets protected location: ${dangerous}`
  }

  const expansion = hasShellExpansion(inputPath)
  if (expansion.has) {
    return "Path contains shell expansion pattern"
  }

  if (hasTraversal(inputPath)) {
    return "Path contains traversal sequence"
  }

  return null
}
