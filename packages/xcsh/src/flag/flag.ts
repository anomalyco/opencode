import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const XCSH_AUTO_SHARE = truthy("XCSH_AUTO_SHARE")
  export const XCSH_GIT_BASH_PATH = process.env["XCSH_GIT_BASH_PATH"]
  export const XCSH_CONFIG = process.env["XCSH_CONFIG"]
  export declare const XCSH_PURE: boolean
  export declare const XCSH_TUI_CONFIG: string | undefined
  export declare const XCSH_CONFIG_DIR: string | undefined
  export declare const XCSH_PLUGIN_META_FILE: string | undefined
  export const XCSH_CONFIG_CONTENT = process.env["XCSH_CONFIG_CONTENT"]
  export const XCSH_DISABLE_AUTOUPDATE = truthy("XCSH_DISABLE_AUTOUPDATE")
  export const XCSH_ALWAYS_NOTIFY_UPDATE = truthy("XCSH_ALWAYS_NOTIFY_UPDATE")
  export const XCSH_DISABLE_PRUNE = truthy("XCSH_DISABLE_PRUNE")
  export const XCSH_DISABLE_TERMINAL_TITLE = truthy("XCSH_DISABLE_TERMINAL_TITLE")
  export const XCSH_SHOW_TTFD = truthy("XCSH_SHOW_TTFD")
  export const XCSH_PERMISSION = process.env["XCSH_PERMISSION"]
  export const XCSH_DISABLE_DEFAULT_PLUGINS = truthy("XCSH_DISABLE_DEFAULT_PLUGINS")
  export const XCSH_DISABLE_LSP_DOWNLOAD = truthy("XCSH_DISABLE_LSP_DOWNLOAD")
  export const XCSH_ENABLE_EXPERIMENTAL_MODELS = truthy("XCSH_ENABLE_EXPERIMENTAL_MODELS")
  export const XCSH_DISABLE_AUTOCOMPACT = truthy("XCSH_DISABLE_AUTOCOMPACT")
  export const XCSH_DISABLE_MODELS_FETCH = truthy("XCSH_DISABLE_MODELS_FETCH")
  export const XCSH_DISABLE_CLAUDE_CODE = truthy("XCSH_DISABLE_CLAUDE_CODE")
  export const XCSH_DISABLE_CLAUDE_CODE_PROMPT =
    XCSH_DISABLE_CLAUDE_CODE || truthy("XCSH_DISABLE_CLAUDE_CODE_PROMPT")
  export const XCSH_DISABLE_CLAUDE_CODE_SKILLS =
    XCSH_DISABLE_CLAUDE_CODE || truthy("XCSH_DISABLE_CLAUDE_CODE_SKILLS")
  export const XCSH_DISABLE_EXTERNAL_SKILLS =
    XCSH_DISABLE_CLAUDE_CODE_SKILLS || truthy("XCSH_DISABLE_EXTERNAL_SKILLS")
  export declare const XCSH_DISABLE_PROJECT_CONFIG: boolean
  export const XCSH_FAKE_VCS = process.env["XCSH_FAKE_VCS"]
  export declare const XCSH_CLIENT: string
  export const XCSH_SERVER_PASSWORD = process.env["XCSH_SERVER_PASSWORD"]
  export const XCSH_SERVER_USERNAME = process.env["XCSH_SERVER_USERNAME"]
  export const XCSH_ENABLE_QUESTION_TOOL = truthy("XCSH_ENABLE_QUESTION_TOOL")

  // Experimental
  export const XCSH_EXPERIMENTAL = truthy("XCSH_EXPERIMENTAL")
  export const XCSH_EXPERIMENTAL_FILEWATCHER = Config.boolean("XCSH_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const XCSH_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "XCSH_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const XCSH_EXPERIMENTAL_ICON_DISCOVERY =
    XCSH_EXPERIMENTAL || truthy("XCSH_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["XCSH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const XCSH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("XCSH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const XCSH_ENABLE_EXA =
    truthy("XCSH_ENABLE_EXA") || XCSH_EXPERIMENTAL || truthy("XCSH_EXPERIMENTAL_EXA")
  export const XCSH_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("XCSH_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const XCSH_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("XCSH_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const XCSH_EXPERIMENTAL_OXFMT = XCSH_EXPERIMENTAL || truthy("XCSH_EXPERIMENTAL_OXFMT")
  export const XCSH_EXPERIMENTAL_LSP_TY = truthy("XCSH_EXPERIMENTAL_LSP_TY")
  export const XCSH_EXPERIMENTAL_LSP_TOOL = XCSH_EXPERIMENTAL || truthy("XCSH_EXPERIMENTAL_LSP_TOOL")
  export const XCSH_DISABLE_FILETIME_CHECK = Config.boolean("XCSH_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const XCSH_EXPERIMENTAL_PLAN_MODE = XCSH_EXPERIMENTAL || truthy("XCSH_EXPERIMENTAL_PLAN_MODE")
  export const XCSH_EXPERIMENTAL_WORKSPACES = XCSH_EXPERIMENTAL || truthy("XCSH_EXPERIMENTAL_WORKSPACES")
  export const XCSH_EXPERIMENTAL_MARKDOWN = !falsy("XCSH_EXPERIMENTAL_MARKDOWN")
  export const XCSH_MODELS_URL = process.env["XCSH_MODELS_URL"]
  export const XCSH_MODELS_PATH = process.env["XCSH_MODELS_PATH"]
  export const XCSH_DISABLE_EMBEDDED_WEB_UI = truthy("XCSH_DISABLE_EMBEDDED_WEB_UI")
  export const XCSH_DB = process.env["XCSH_DB"]
  export const XCSH_DISABLE_CHANNEL_DB = truthy("XCSH_DISABLE_CHANNEL_DB")
  export const XCSH_SKIP_MIGRATIONS = truthy("XCSH_SKIP_MIGRATIONS")
  export const XCSH_STRICT_CONFIG_DEPS = truthy("XCSH_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for XCSH_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "XCSH_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("XCSH_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for XCSH_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "XCSH_TUI_CONFIG", {
  get() {
    return process.env["XCSH_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for XCSH_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "XCSH_CONFIG_DIR", {
  get() {
    return process.env["XCSH_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for XCSH_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "XCSH_PURE", {
  get() {
    return truthy("XCSH_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for XCSH_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "XCSH_PLUGIN_META_FILE", {
  get() {
    return process.env["XCSH_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for XCSH_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "XCSH_CLIENT", {
  get() {
    return process.env["XCSH_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
