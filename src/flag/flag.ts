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
  export const ATHENA_AUTO_SHARE = truthy("ATHENA_AUTO_SHARE")
  export const ATHENA_GIT_BASH_PATH = process.env["ATHENA_GIT_BASH_PATH"]
  export const ATHENA_CONFIG = process.env["ATHENA_CONFIG"]
  export declare const ATHENA_PURE: boolean
  export declare const ATHENA_TUI_CONFIG: string | undefined
  export declare const ATHENA_CONFIG_DIR: string | undefined
  export declare const ATHENA_PLUGIN_META_FILE: string | undefined
  export const ATHENA_CONFIG_CONTENT = process.env["ATHENA_CONFIG_CONTENT"]
  export const ATHENA_DISABLE_AUTOUPDATE = truthy("ATHENA_DISABLE_AUTOUPDATE")
  export const ATHENA_ALWAYS_NOTIFY_UPDATE = truthy("ATHENA_ALWAYS_NOTIFY_UPDATE")
  export const ATHENA_DISABLE_PRUNE = truthy("ATHENA_DISABLE_PRUNE")
  export const ATHENA_DISABLE_TERMINAL_TITLE = truthy("ATHENA_DISABLE_TERMINAL_TITLE")
  export const ATHENA_SHOW_TTFD = truthy("ATHENA_SHOW_TTFD")
  export const ATHENA_PERMISSION = process.env["ATHENA_PERMISSION"]
  export const ATHENA_DISABLE_DEFAULT_PLUGINS = truthy("ATHENA_DISABLE_DEFAULT_PLUGINS")
  export const ATHENA_DISABLE_LSP_DOWNLOAD = truthy("ATHENA_DISABLE_LSP_DOWNLOAD")
  export const ATHENA_ENABLE_EXPERIMENTAL_MODELS = truthy("ATHENA_ENABLE_EXPERIMENTAL_MODELS")
  export const ATHENA_DISABLE_AUTOCOMPACT = truthy("ATHENA_DISABLE_AUTOCOMPACT")
  export const ATHENA_DISABLE_MODELS_FETCH = truthy("ATHENA_DISABLE_MODELS_FETCH")
  export const ATHENA_DISABLE_CLAUDE_CODE = truthy("ATHENA_DISABLE_CLAUDE_CODE")
  export const ATHENA_DISABLE_CLAUDE_CODE_PROMPT =
    ATHENA_DISABLE_CLAUDE_CODE || truthy("ATHENA_DISABLE_CLAUDE_CODE_PROMPT")
  export const ATHENA_DISABLE_CLAUDE_CODE_SKILLS =
    ATHENA_DISABLE_CLAUDE_CODE || truthy("ATHENA_DISABLE_CLAUDE_CODE_SKILLS")
  export const ATHENA_DISABLE_EXTERNAL_SKILLS =
    ATHENA_DISABLE_CLAUDE_CODE_SKILLS || truthy("ATHENA_DISABLE_EXTERNAL_SKILLS")
  export declare const ATHENA_DISABLE_PROJECT_CONFIG: boolean
  export const ATHENA_FAKE_VCS = process.env["ATHENA_FAKE_VCS"]
  export declare const ATHENA_CLIENT: string
  export const ATHENA_SERVER_PASSWORD = process.env["ATHENA_SERVER_PASSWORD"]
  export const ATHENA_SERVER_USERNAME = process.env["ATHENA_SERVER_USERNAME"]
  export const ATHENA_ENABLE_QUESTION_TOOL = truthy("ATHENA_ENABLE_QUESTION_TOOL")

  // Experimental
  export const ATHENA_EXPERIMENTAL = truthy("ATHENA_EXPERIMENTAL")
  export const ATHENA_EXPERIMENTAL_FILEWATCHER = Config.boolean("ATHENA_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const ATHENA_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "ATHENA_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const ATHENA_EXPERIMENTAL_ICON_DISCOVERY =
    ATHENA_EXPERIMENTAL || truthy("ATHENA_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["ATHENA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const ATHENA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("ATHENA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const ATHENA_ENABLE_EXA =
    truthy("ATHENA_ENABLE_EXA") || ATHENA_EXPERIMENTAL || truthy("ATHENA_EXPERIMENTAL_EXA")
  export const ATHENA_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("ATHENA_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const ATHENA_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("ATHENA_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const ATHENA_EXPERIMENTAL_OXFMT = ATHENA_EXPERIMENTAL || truthy("ATHENA_EXPERIMENTAL_OXFMT")
  export const ATHENA_EXPERIMENTAL_LSP_TY = truthy("ATHENA_EXPERIMENTAL_LSP_TY")
  export const ATHENA_EXPERIMENTAL_LSP_TOOL = ATHENA_EXPERIMENTAL || truthy("ATHENA_EXPERIMENTAL_LSP_TOOL")
  export const ATHENA_DISABLE_FILETIME_CHECK = Config.boolean("ATHENA_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const ATHENA_EXPERIMENTAL_PLAN_MODE = ATHENA_EXPERIMENTAL || truthy("ATHENA_EXPERIMENTAL_PLAN_MODE")
  export const ATHENA_EXPERIMENTAL_WORKSPACES = ATHENA_EXPERIMENTAL || truthy("ATHENA_EXPERIMENTAL_WORKSPACES")
  export const ATHENA_EXPERIMENTAL_MARKDOWN = !falsy("ATHENA_EXPERIMENTAL_MARKDOWN")
  export const ATHENA_MODELS_URL = process.env["ATHENA_MODELS_URL"]
  export const ATHENA_MODELS_PATH = process.env["ATHENA_MODELS_PATH"]
  export const ATHENA_DISABLE_EMBEDDED_WEB_UI = truthy("ATHENA_DISABLE_EMBEDDED_WEB_UI")
  export const ATHENA_DB = process.env["ATHENA_DB"]
  export const ATHENA_DISABLE_CHANNEL_DB = truthy("ATHENA_DISABLE_CHANNEL_DB")
  export const ATHENA_SKIP_MIGRATIONS = truthy("ATHENA_SKIP_MIGRATIONS")
  export const ATHENA_STRICT_CONFIG_DEPS = truthy("ATHENA_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for ATHENA_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ATHENA_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("ATHENA_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ATHENA_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "ATHENA_TUI_CONFIG", {
  get() {
    return process.env["ATHENA_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ATHENA_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ATHENA_CONFIG_DIR", {
  get() {
    return process.env["ATHENA_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ATHENA_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "ATHENA_PURE", {
  get() {
    return truthy("ATHENA_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ATHENA_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "ATHENA_PLUGIN_META_FILE", {
  get() {
    return process.env["ATHENA_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ATHENA_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "ATHENA_CLIENT", {
  get() {
    return process.env["ATHENA_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
