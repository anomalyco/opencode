/**
 * Persistence Extensions Factory
 *
 * Provides persistence-level extensions for cloud functionality including:
 * - Server-scoped storage configuration
 * - Cache key transformation for multi-server environments
 */

import type { PersistExtensions } from "@opencode-ai/app-shared"
import type { ClaxedoConfig } from "../index"

/**
 * Create persistence extensions for Claxedo cloud mode.
 *
 * In cloud mode, users may connect to multiple different server instances
 * (sandboxes). To prevent cache conflicts and data leakage between servers,
 * we enable server-scoped persistence.
 *
 * When serverScoped is true:
 * - LocalStorage keys are prefixed with the server URL hash
 * - Each server has its own isolated cache namespace
 * - Switching servers loads fresh state
 *
 * @param config - Claxedo configuration
 * @returns PersistExtensions object to register with the extension system
 */
export function persistExtensions(config: ClaxedoConfig): PersistExtensions {
  return {
    /**
     * Enable server-scoped persistence.
     *
     * When true, the Persist utility will use server-specific storage targets:
     * - Persist.serverWorkspace() instead of Persist.workspace()
     * - Persist.serverSession() instead of Persist.session()
     *
     * This ensures data isolation between different cloud sandboxes.
     *
     * Default: true in cloud mode (can be disabled via config)
     */
    serverScoped: config.serverScopedPersist ?? true,
  }
}
