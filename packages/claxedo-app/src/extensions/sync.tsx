/**
 * Sync Extensions Factory
 *
 * Provides sync-level extensions for cloud functionality including:
 * - Server change notifications
 * - State cleanup on server switch
 * - Re-bootstrap logic for new server connections
 */

import type { SyncExtensions } from "@opencode-ai/app-shared"
import type { ClaxedoConfig } from "../index"

/**
 * Create sync extensions for Claxedo cloud mode.
 *
 * In cloud mode, users can switch between different server instances
 * (sandboxes). When the server changes, we may need to:
 * - Clean up stale subscriptions
 * - Reset cached state
 * - Re-initialize connections
 *
 * @param config - Claxedo configuration
 * @returns SyncExtensions object to register with the extension system
 */
export function syncExtensions(_config: ClaxedoConfig): SyncExtensions {
  return {
    /**
     * Called when the active server URL changes.
     *
     * Use this hook to:
     * - Cancel pending requests to the old server
     * - Clear cached data that's server-specific
     * - Initialize connections to the new server
     *
     * @param newUrl - The new server URL being connected to
     * @param oldUrl - The previous server URL (empty string if first connection)
     */
    onServerChange: (newUrl: string, oldUrl: string): void => {
      if (import.meta.env.DEV) {
        console.log(`[claxedo] Server changed: ${oldUrl || "(none)"} -> ${newUrl}`)
      }

      // Clean up any cloud-specific state here.
      // Examples:
      // - Abort pending fetch requests
      // - Close WebSocket connections
      // - Clear server-specific caches

      // Note: Most cleanup is handled automatically by the Persist extension
      // when serverScoped is enabled. This hook is for additional cleanup needs.
    },
  }
}
