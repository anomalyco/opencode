/**
 * Shared type definitions used across multiple modules.
 * Import from here to avoid circular dependencies.
 */

/** Standard result type for operations that can fail */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

/** Provider identification */
export interface ProviderInfo {
  id: string
  name: string
  npm?: string
}

/** Model identification */
export interface ModelInfo {
  id: string
  provider: ProviderInfo
  name: string
  limit: {
    input: number
    output: number
  }
}

/** Tool execution context (minimal shared interface) */
export interface ToolContext {
  sessionID: string
  abort: AbortSignal
}
