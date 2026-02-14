import type { TUIDependencies } from "./types.js"

let tuiDependencies: TUIDependencies | null = null

/**
 * Initialize TUI dependencies from OpenCode
 * This must be called before using any TUI components
 */
export function initializeTUIDependencies(deps: TUIDependencies) {
  tuiDependencies = deps
}

/**
 * Get injected TUI dependencies
 * Throws if dependencies haven't been initialized
 */
export function getTUIDependencies(): TUIDependencies {
  if (!tuiDependencies) {
    throw new Error("TUI dependencies not initialized. Call initializeTUIDependencies() first.")
  }
  return tuiDependencies
}

/**
 * Check if TUI dependencies are initialized
 */
export function areTUIDependenciesInitialized(): boolean {
  return tuiDependencies !== null
}
