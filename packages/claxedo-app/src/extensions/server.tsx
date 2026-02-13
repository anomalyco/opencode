/**
 * Server Extensions Factory
 *
 * Provides server-level extensions for cloud functionality including:
 * - URL transformation/canonicalization
 */

import type { ServerExtensions } from "@opencode-ai/app-shared"
import type { ClaxedoConfig } from "../index"

/**
 * Create server extensions for Claxedo cloud mode.
 *
 * @param config - Claxedo configuration
 * @returns ServerExtensions object to register with the extension system
 */
export function serverExtensions(config: ClaxedoConfig): ServerExtensions {
  return {
    /**
     * Transform server URL before use.
     *
     * This can be used for:
     * - URL canonicalization (consistent formatting)
     * - Gateway URL rewriting
     * - Protocol upgrades
     *
     * Currently returns the URL unchanged.
     * Add transformation logic here if needed.
     */
    transformUrl: (url: string): string => {
      // Canonicalize: remove trailing slashes for consistency
      return url.replace(/\/+$/, "")
    },
  }
}
