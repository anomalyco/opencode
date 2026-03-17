import { Config } from "effect"

/**
 * Checks if an environment variable is truthy.
 *
 * @param key - The environment variable name
 * @returns True if value is "true" or "1" (case-insensitive)
 */
function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

/**
 * Checks if an environment variable is falsy.
 *
 * @param key - The environment variable name
 * @returns True if value is "false" or "0" (case-insensitive)
 */
function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

/**
 * Feature flags and environment configuration namespace.
 *
 * Provides centralized access to all environment variable-based feature flags
 * and configuration options used throughout OpenCode. Flags are evaluated at
 * module load time unless marked as dynamic getters for runtime evaluation.
 *
 * @example
 * ```typescript
 * if (Flag.OPENCODE_EXPERIMENTAL) {
 *   // Enable experimental features
 * }
 * ```
 */
export namespace Flag {
  /**
   * Enable automatic sharing functionality.
   * Set `OPENCODE_AUTO_SHARE=true` to enable.
   */
  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")

  /**
   * Custom path to Git Bash executable on Windows.
   * Set via `OPENCODE_GIT_BASH_PATH` environment variable.
   */
  export const OPENCODE_GIT_BASH_PATH = process.env["OPENCODE_GIT_BASH_PATH"]

  /**
   * Path to a custom OpenCode configuration file.
   * Set via `OPENCODE_CONFIG` environment variable.
   */
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]

  /**
   * Path to TUI-specific configuration file.
   * Dynamically evaluated at access time for testing flexibility.
   */
  export declare const OPENCODE_TUI_CONFIG: string | undefined

  /**
   * Directory containing OpenCode configuration files.
   * Dynamically evaluated at access time for external tooling compatibility.
   */
  export declare const OPENCODE_CONFIG_DIR: string | undefined

  /**
   * Raw configuration content as a string (for embedded configs).
   * Set via `OPENCODE_CONFIG_CONTENT` environment variable.
   */
  export const OPENCODE_CONFIG_CONTENT = process.env["OPENCODE_CONFIG_CONTENT"]

  /**
   * Disable automatic update checks.
   * Set `OPENCODE_DISABLE_AUTOUPDATE=true` to disable.
   */
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("OPENCODE_DISABLE_AUTOUPDATE")

  /**
   * Disable automatic pruning of old data.
   * Set `OPENCODE_DISABLE_PRUNE=true` to disable.
   */
  export const OPENCODE_DISABLE_PRUNE = truthy("OPENCODE_DISABLE_PRUNE")

  /**
   * Disable setting terminal title.
   * Set `OPENCODE_DISABLE_TERMINAL_TITLE=true` to disable.
   */
  export const OPENCODE_DISABLE_TERMINAL_TITLE = truthy("OPENCODE_DISABLE_TERMINAL_TITLE")

  /**
   * Permission level for operations.
   * Set via `OPENCODE_PERMISSION` environment variable.
   */
  export const OPENCODE_PERMISSION = process.env["OPENCODE_PERMISSION"]

  /**
   * Disable default plugins.
   * Set `OPENCODE_DISABLE_DEFAULT_PLUGINS=true` to disable.
   */
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS")

  /**
   * Disable automatic LSP server downloads.
   * Set `OPENCODE_DISABLE_LSP_DOWNLOAD=true` to disable.
   */
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("OPENCODE_DISABLE_LSP_DOWNLOAD")

  /**
   * Enable experimental model support.
   * Set `OPENCODE_ENABLE_EXPERIMENTAL_MODELS=true` to enable.
   */
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENCODE_ENABLE_EXPERIMENTAL_MODELS")

  /**
   * Disable automatic database compaction.
   * Set `OPENCODE_DISABLE_AUTOCOMPACT=true` to disable.
   */
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy("OPENCODE_DISABLE_AUTOCOMPACT")

  /**
   * Disable fetching models from remote.
   * Set `OPENCODE_DISABLE_MODELS_FETCH=true` to disable.
   */
  export const OPENCODE_DISABLE_MODELS_FETCH = truthy("OPENCODE_DISABLE_MODELS_FETCH")

  /**
   * Disable Claude Code integration.
   * Set `OPENCODE_DISABLE_CLAUDE_CODE=true` to disable.
   */
  export const OPENCODE_DISABLE_CLAUDE_CODE = truthy("OPENCODE_DISABLE_CLAUDE_CODE")

  /**
   * Disable Claude Code prompt features.
   * Automatically disabled if `OPENCODE_DISABLE_CLAUDE_CODE` is set.
   */
  export const OPENCODE_DISABLE_CLAUDE_CODE_PROMPT =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT")

  /**
   * Disable Claude Code skills.
   * Automatically disabled if `OPENCODE_DISABLE_CLAUDE_CODE` is set.
   */
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS")

  /**
   * Disable external skills.
   * Automatically disabled if `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` is set.
   */
  export const OPENCODE_DISABLE_EXTERNAL_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("OPENCODE_DISABLE_EXTERNAL_SKILLS")

  /**
   * Disable project-level configuration files.
   * Dynamically evaluated at access time for external tooling compatibility.
   */
  export declare const OPENCODE_DISABLE_PROJECT_CONFIG: boolean

  /**
   * Fake VCS information (for testing).
   * Set via `OPENCODE_FAKE_VCS` environment variable.
   */
  export const OPENCODE_FAKE_VCS = process.env["OPENCODE_FAKE_VCS"]

  /**
   * Client identifier (e.g., "cli", "vscode").
   * Dynamically evaluated at access time. Defaults to "cli".
   */
  export declare const OPENCODE_CLIENT: string

  /**
   * Server password for basic authentication.
   * Set via `OPENCODE_SERVER_PASSWORD` environment variable.
   */
  export const OPENCODE_SERVER_PASSWORD = process.env["OPENCODE_SERVER_PASSWORD"]

  /**
   * Server username for basic authentication.
   * Set via `OPENCODE_SERVER_USERNAME` environment variable.
   */
  export const OPENCODE_SERVER_USERNAME = process.env["OPENCODE_SERVER_USERNAME"]

  /**
   * Enable the question tool feature.
   * Set `OPENCODE_ENABLE_QUESTION_TOOL=true` to enable.
   */
  export const OPENCODE_ENABLE_QUESTION_TOOL = truthy("OPENCODE_ENABLE_QUESTION_TOOL")

  // Experimental flags
  /**
   * Master switch for all experimental features.
   * Set `OPENCODE_EXPERIMENTAL=true` to enable all experimental features.
   */
  export const OPENCODE_EXPERIMENTAL = truthy("OPENCODE_EXPERIMENTAL")

  /**
   * Enable experimental file watcher.
   * Controlled via `OPENCODE_EXPERIMENTAL_FILEWATCHER` config.
   */
  export const OPENCODE_EXPERIMENTAL_FILEWATCHER = Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )

  /**
   * Disable experimental file watcher.
   * Controlled via `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` config.
   */
  export const OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))

  /**
   * Enable experimental icon discovery.
   * Enabled by default if `OPENCODE_EXPERIMENTAL` is true.
   */
  export const OPENCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY")

  /**
   * Disable copy-on-select behavior in terminal.
   * Defaults to true on Windows, can be overridden.
   */
  const copy = process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")

  /**
   * Enable Exa search integration.
   * Enabled if `OPENCODE_ENABLE_EXA` or `OPENCODE_EXPERIMENTAL` is true.
   */
  export const OPENCODE_ENABLE_EXA =
    truthy("OPENCODE_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_EXA")

  /**
   * Default timeout for bash operations in milliseconds.
   * Set via `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` environment variable.
   */
  export const OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")

  /**
   * Maximum output tokens for model responses.
   * Set via `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` environment variable.
   */
  export const OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")

  /**
   * Enable experimental output formatting.
   * Enabled by default if `OPENCODE_EXPERIMENTAL` is true.
   */
  export const OPENCODE_EXPERIMENTAL_OXFMT = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OXFMT")

  /**
   * Enable experimental LSP TypeScript support.
   * Set `OPENCODE_EXPERIMENTAL_LSP_TY=true` to enable.
   */
  export const OPENCODE_EXPERIMENTAL_LSP_TY = truthy("OPENCODE_EXPERIMENTAL_LSP_TY")

  /**
   * Enable experimental LSP tool integration.
   * Enabled by default if `OPENCODE_EXPERIMENTAL` is true.
   */
  export const OPENCODE_EXPERIMENTAL_LSP_TOOL = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_LSP_TOOL")

  /**
   * Disable file time checks for caching.
   * Controlled via `OPENCODE_DISABLE_FILETIME_CHECK` config.
   */
  export const OPENCODE_DISABLE_FILETIME_CHECK = Config.boolean("OPENCODE_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )

  /**
   * Enable experimental plan mode.
   * Enabled by default if `OPENCODE_EXPERIMENTAL` is true.
   */
  export const OPENCODE_EXPERIMENTAL_PLAN_MODE = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_PLAN_MODE")

  /**
   * Enable experimental workspaces feature.
   * Enabled by default if `OPENCODE_EXPERIMENTAL` is true.
   */
  export const OPENCODE_EXPERIMENTAL_WORKSPACES = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_WORKSPACES")

  /**
   * Enable experimental markdown features.
   * Enabled by default unless explicitly set to false.
   */
  export const OPENCODE_EXPERIMENTAL_MARKDOWN = !falsy("OPENCODE_EXPERIMENTAL_MARKDOWN")

  /**
   * Custom URL for fetching model definitions.
   * Set via `OPENCODE_MODELS_URL` environment variable.
   */
  export const OPENCODE_MODELS_URL = process.env["OPENCODE_MODELS_URL"]

  /**
   * Custom path to local models file.
   * Set via `OPENCODE_MODELS_PATH` environment variable.
   */
  export const OPENCODE_MODELS_PATH = process.env["OPENCODE_MODELS_PATH"]

  /**
   * Disable channel database.
   * Set `OPENCODE_DISABLE_CHANNEL_DB=true` to disable.
   */
  export const OPENCODE_DISABLE_CHANNEL_DB = truthy("OPENCODE_DISABLE_CHANNEL_DB")

  /**
   * Skip database migrations on startup.
   * Set `OPENCODE_SKIP_MIGRATIONS=true` to skip.
   */
  export const OPENCODE_SKIP_MIGRATIONS = truthy("OPENCODE_SKIP_MIGRATIONS")

  /**
   * Enforce strict configuration dependency checking.
   * Set `OPENCODE_STRICT_CONFIG_DEPS=true` to enable.
   */
  export const OPENCODE_STRICT_CONFIG_DEPS = truthy("OPENCODE_STRICT_CONFIG_DEPS")

  /**
   * Parses a numeric environment variable.
   *
   * @param key - The environment variable name
   * @returns The parsed positive integer, or undefined if invalid/not set
   */
  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for OPENCODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_TUI_CONFIG", {
  get() {
    return process.env["OPENCODE_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get() {
    return process.env["OPENCODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "OPENCODE_CLIENT", {
  get() {
    return process.env["OPENCODE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
