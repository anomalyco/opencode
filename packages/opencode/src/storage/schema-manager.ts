import { Global } from "../global"
import path from "path"
import { xdgData } from "xdg-basedir"

/**
 * Schema Manager for CodeSurf Migration
 *
 * Handles storage routing for features based on compatibility mode.
 * In compatibility mode (CODESURF_FOLDER=".opencode"), CodeSurf-specific
 * features are stored separately to avoid breaking OpenCode's schema.
 */
export namespace SchemaManager {
  /**
   * Check if we're running in OpenCode compatibility mode
   */
  export function isCompatibilityMode(): boolean {
    return process.env["CODESURF_FOLDER"] === ".opencode"
  }

  /**
   * Get the project-level folder name (.codesurf or .opencode)
   */
  export function getProjectFolder(): string {
    return process.env["CODESURF_FOLDER"] || ".codesurf"
  }

  /**
   * Get storage path based on feature type
   *
   * @param feature - Feature type: "shared" works in both modes, "codesurf-only" needs separate storage in compat mode
   * @returns Storage directory path
   */
  export function getStoragePath(feature: "shared" | "codesurf-only"): string {
    if (feature === "shared") {
      // Shared features use the main Global.Path.data (respects compat mode)
      return Global.Path.data
    }

    if (feature === "codesurf-only") {
      if (isCompatibilityMode()) {
        // In compat mode, store CodeSurf-specific features separately
        // to avoid polluting OpenCode's schema
        return path.join(xdgData!, "codesurf-extensions")
      }
      // Normal CodeSurf mode uses main storage
      return Global.Path.data
    }

    return Global.Path.data
  }

  /**
   * Features that are compatible with both OpenCode and CodeSurf schemas
   */
  export const SHARED_FEATURES = [
    "sessions",
    "messages",
    "providers",
    "agents",
    "tools",
    "keybindings",
    "config",
    "snapshots",
  ] as const

  /**
   * Features specific to CodeSurf that shouldn't be in OpenCode schema
   */
  export const CODESURF_ONLY_FEATURES = ["voice", "personas", "advanced-orchestration", "custom-widgets"] as const

  /**
   * Check if a feature should use separate storage in compat mode
   */
  export function isCodesurfOnlyFeature(feature: string): boolean {
    return CODESURF_ONLY_FEATURES.includes(feature as any)
  }
}
