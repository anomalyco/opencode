import path from "path"
import { Instance } from "../project/instance"
import { isDangerousDirectory, hasShellExpansion, hasTraversal } from "../util/path-validation"

/**
 * Hard-block for dangerous paths that should never be accessed.
 * These paths are protected regardless of permission mode or allow rules.
 */
export function assertSafePath(target: string, opts?: { allowEnv?: boolean }): void {
  if (!target) return

  // 1. Block shell expansion patterns - these are always dangerous (check before resolving)
  const expansionCheck = hasShellExpansion(target)
  if (expansionCheck.has) {
    throw new Error(
      `Security error: Path contains shell expansion pattern '${expansionCheck.pattern}'. ` +
        `This is blocked for security reasons.`,
    )
  }

  // 2. Block path traversal that escapes working directory (check before resolving)
  if (hasTraversal(target)) {
    // Resolve the path relative to the working directory and check if it escapes
    const resolved = path.resolve(Instance.directory, target)
    const worktree = Instance.worktree

    // Check if the resolved path is within the working directory
    const normalizedResolved = path.normalize(resolved)
    const normalizedWorktree = path.normalize(worktree)

    if (!normalizedResolved.startsWith(normalizedWorktree + path.sep) && normalizedResolved !== normalizedWorktree) {
      throw new Error(
        `Security error: Path traversal blocked. Path '${target}' would resolve to '${resolved}', ` +
          `which is outside the working directory '${worktree}'.`,
      )
    }
  }

  // 3. Resolve to absolute path for dangerous directory check
  const full = path.isAbsolute(target) ? target : path.resolve(Instance.directory, target)

  // 4. Hard-block dangerous directories
  const dangerousResult = isDangerousDirectory(full)
  if (dangerousResult) {
    if (opts?.allowEnv && [".env file", ".env.* file"].includes(dangerousResult)) return
    throw new Error(
      `Security error: Access to ${dangerousResult} is blocked for safety. ` +
        `This location contains sensitive configuration or data that should not be modified by tools. ` +
        `Path: ${full}`,
    )
  }
}

/**
 * Check if a path is safe to access (returns boolean instead of throwing).
 * Useful for pre-checking paths before operations.
 */
export function isPathSafe(target: string): { safe: boolean; reason?: string } {
  try {
    assertSafePath(target)
    return { safe: true }
  } catch (error) {
    return {
      safe: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
