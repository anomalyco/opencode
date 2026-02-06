import path from "path"
import os from "os"
import { parse as parseJsonc } from "jsonc-parser"
import { AuthConfig, type AuthConfig as AuthConfigType } from "./config"

function configDir(): string {
  const home = process.env.OPENCODE_TEST_HOME || os.homedir()
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
  return path.join(xdgConfig, "opencode")
}

async function exists(file: string): Promise<boolean> {
  return Bun.file(file)
    .stat()
    .then(() => true)
    .catch(() => false)
}

async function* findDotOpencodeDirs(start: string): AsyncGenerator<string> {
  let current = start
  while (true) {
    const dir = path.join(current, ".opencode")
    if (await exists(dir)) yield dir
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}

function isTrue(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

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
    const disableProjectConfig = isTrue(process.env.OPENCODE_DISABLE_PROJECT_CONFIG)

    // Search for config files, walking up from cwd
    // Also check global config directory
    const configFiles = ["opencode.jsonc", "opencode.json"]
    const searchPaths: string[] = []

    // Project config is optional in CI/e2e; follow the same env gate used by Config.
    if (!disableProjectConfig) {
      for await (const dir of findDotOpencodeDirs(cwd)) {
        for (const file of configFiles) {
          searchPaths.push(path.join(dir, file))
        }
      }
    }

    // Also check global config
    for (const file of configFiles) {
      searchPaths.push(path.join(configDir(), file))
    }

    for (const configPath of searchPaths) {
      if (await exists(configPath)) {
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

    // Default: auth disabled when no auth section is found.
    _config = AuthConfig.parse({ enabled: false })
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
