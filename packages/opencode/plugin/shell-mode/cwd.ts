/**
 * Working directory state management for shell mode.
 * Tracks the current working directory independently from Instance.directory.
 */

import { Instance } from "@/project/instance"
import path from "path"
import os from "os"

let currentCwd: string | null = null

/**
 * Get the current working directory.
 * Returns Instance.directory if not explicitly set.
 */
export function getCwd(): string {
  if (currentCwd === null) {
    return Instance.directory
  }
  return currentCwd
}

/**
 * Set the current working directory.
 * Handles ~ expansion and relative path resolution.
 */
export function setCwd(dir: string): void {
  let resolved = dir

  // Handle ~ expansion
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1))
  }

  // Resolve relative paths against current cwd
  if (!path.isAbsolute(resolved)) {
    resolved = path.resolve(getCwd(), resolved)
  }

  currentCwd = resolved
}

/**
 * Reset the working directory to Instance.directory.
 */
export function resetCwd(): void {
  currentCwd = null
}
