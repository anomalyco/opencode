import path from "path"
import { parse as parseJsonc } from "jsonc-parser"
import { AuthConfig, type AuthConfig as AuthConfigType } from "./auth"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { Flag } from "../flag/flag"

/**
 * Server-level auth configuration.
 *
 * Loaded once at server startup from the current working directory's
 * .opencode/opencode.json or .opencode/opencode.jsonc file.
 *
 * This avoids the need for Instance context, allowing auth middleware
 * and routes to run before Instance.provide.
 */
export namespace ServerAuth {
  let _config: AuthConfigType | undefined

  /**
   * Load auth config from the current working directory.
   * Should be called once at server startup.
   */
  export async function load(): Promise<void> {
    const cwd = process.cwd()

    // Search for config files, walking up from cwd
    // Also check global config directory
    const configFiles = ["opencode.jsonc", "opencode.json"]
    const searchPaths: string[] = []

    // Find .opencode directories walking up from cwd unless project config is disabled.
    if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      for await (const dir of Filesystem.up({ targets: [".opencode"], start: cwd })) {
        for (const file of configFiles) {
          searchPaths.push(path.join(dir, file))
        }
      }
    }

    // Also check global config
    for (const file of configFiles) {
      searchPaths.push(path.join(Global.Path.config, file))
    }

    for (const configPath of searchPaths) {
      if (await Filesystem.exists(configPath)) {
        try {
          const text = await Bun.file(configPath).text()
          const parsed = parseJsonc(text, undefined, { allowTrailingComma: true })

          if (parsed?.auth) {
            const result = AuthConfig.safeParse(parsed.auth)
            if (result.success) {
              _config = result.data
              return
            }
          }
        } catch {
          // Invalid config file, fall through to next
        }
      }
    }

    // Default: auth disabled
    _config = AuthConfig.parse({})
  }

  /**
   * Get the loaded auth config.
   * Returns default (disabled) config if load() hasn't been called.
   */
  export function get(): AuthConfigType {
    if (!_config) {
      // Return default if not loaded (shouldn't happen in normal flow)
      return AuthConfig.parse({})
    }
    return _config
  }

  /**
   * Check if auth is enabled.
   */
  export function isEnabled(): boolean {
    return get().enabled
  }

  /**
   * Set auth config directly (for testing only).
   * @internal
   */
  export function _setForTesting(config: AuthConfigType): void {
    _config = config
  }

  /**
   * Reset to unloaded state (for testing only).
   * @internal
   */
  export function _reset(): void {
    _config = undefined
  }
}
