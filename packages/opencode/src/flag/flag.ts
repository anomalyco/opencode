import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function env(key: string, fallback?: string) {
  return process.env[key] ?? (fallback ? process.env[fallback] : undefined)
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const OTEL_EXPORTER_OTLP_ENDPOINT = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
  export const OTEL_EXPORTER_OTLP_HEADERS = process.env["OTEL_EXPORTER_OTLP_HEADERS"]

  export const MAMMOUTH_AUTO_SHARE = truthy("MAMMOUTH_AUTO_SHARE")
  export const MAMMOUTH_AUTO_HEAP_SNAPSHOT = truthy("MAMMOUTH_AUTO_HEAP_SNAPSHOT")
  export const MAMMOUTH_GIT_BASH_PATH = process.env["MAMMOUTH_GIT_BASH_PATH"]
  export const MAMMOUTH_CONFIG = process.env["MAMMOUTH_CONFIG"]
  export declare const MAMMOUTH_PURE: boolean
  export declare const MAMMOUTH_TUI_CONFIG: string | undefined
  export declare const MAMMOUTH_CONFIG_DIR: string | undefined
  export declare const MAMMOUTH_PLUGIN_META_FILE: string | undefined
  export const MAMMOUTH_CONFIG_CONTENT = process.env["MAMMOUTH_CONFIG_CONTENT"]
  export const MAMMOUTH_DISABLE_AUTOUPDATE = truthy("MAMMOUTH_DISABLE_AUTOUPDATE")
  export const MAMMOUTH_ALWAYS_NOTIFY_UPDATE = truthy("MAMMOUTH_ALWAYS_NOTIFY_UPDATE")
  export const MAMMOUTH_DISABLE_PRUNE = truthy("MAMMOUTH_DISABLE_PRUNE")
  export const MAMMOUTH_DISABLE_TERMINAL_TITLE = truthy("MAMMOUTH_DISABLE_TERMINAL_TITLE")
  export const MAMMOUTH_SHOW_TTFD = truthy("MAMMOUTH_SHOW_TTFD")
  export const MAMMOUTH_PERMISSION = process.env["MAMMOUTH_PERMISSION"]
  export const MAMMOUTH_DISABLE_DEFAULT_PLUGINS = truthy("MAMMOUTH_DISABLE_DEFAULT_PLUGINS")
  export const MAMMOUTH_DISABLE_LSP_DOWNLOAD = truthy("MAMMOUTH_DISABLE_LSP_DOWNLOAD")
  export const MAMMOUTH_ENABLE_EXPERIMENTAL_MODELS = truthy("MAMMOUTH_ENABLE_EXPERIMENTAL_MODELS")
  export const MAMMOUTH_DISABLE_AUTOCOMPACT = truthy("MAMMOUTH_DISABLE_AUTOCOMPACT")
  export const MAMMOUTH_DISABLE_MODELS_FETCH = truthy("MAMMOUTH_DISABLE_MODELS_FETCH")
  export const MAMMOUTH_DISABLE_MOUSE = truthy("MAMMOUTH_DISABLE_MOUSE")
  export const MAMMOUTH_DISABLE_CLAUDE_CODE = truthy("MAMMOUTH_DISABLE_CLAUDE_CODE")
  export const MAMMOUTH_DISABLE_CLAUDE_CODE_PROMPT =
    MAMMOUTH_DISABLE_CLAUDE_CODE || truthy("MAMMOUTH_DISABLE_CLAUDE_CODE_PROMPT")
  export const MAMMOUTH_DISABLE_CLAUDE_CODE_SKILLS =
    MAMMOUTH_DISABLE_CLAUDE_CODE || truthy("MAMMOUTH_DISABLE_CLAUDE_CODE_SKILLS")
  export const MAMMOUTH_DISABLE_EXTERNAL_SKILLS =
    MAMMOUTH_DISABLE_CLAUDE_CODE_SKILLS || truthy("MAMMOUTH_DISABLE_EXTERNAL_SKILLS")
  export declare const MAMMOUTH_DISABLE_PROJECT_CONFIG: boolean
  export const MAMMOUTH_FAKE_VCS = process.env["MAMMOUTH_FAKE_VCS"]
  export declare const MAMMOUTH_CLIENT: string
  export const MAMMOUTH_SERVER_PASSWORD = process.env["MAMMOUTH_SERVER_PASSWORD"]
  export const MAMMOUTH_SERVER_USERNAME = process.env["MAMMOUTH_SERVER_USERNAME"]
  export const MAMMOUTH_ENABLE_QUESTION_TOOL = truthy("MAMMOUTH_ENABLE_QUESTION_TOOL")

  // Experimental
  export const MAMMOUTH_EXPERIMENTAL = truthy("MAMMOUTH_EXPERIMENTAL")
  export const MAMMOUTH_EXPERIMENTAL_FILEWATCHER = Config.boolean("MAMMOUTH_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const MAMMOUTH_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "MAMMOUTH_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const MAMMOUTH_EXPERIMENTAL_ICON_DISCOVERY =
    MAMMOUTH_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["MAMMOUTH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const MAMMOUTH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("MAMMOUTH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const MAMMOUTH_ENABLE_EXA =
    truthy("MAMMOUTH_ENABLE_EXA") || MAMMOUTH_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_EXA")
  export const MAMMOUTH_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("MAMMOUTH_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const MAMMOUTH_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("MAMMOUTH_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const MAMMOUTH_EXPERIMENTAL_OXFMT = MAMMOUTH_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_OXFMT")
  export const MAMMOUTH_EXPERIMENTAL_LSP_TY = truthy("MAMMOUTH_EXPERIMENTAL_LSP_TY")
  export const MAMMOUTH_EXPERIMENTAL_LSP_TOOL = MAMMOUTH_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_LSP_TOOL")
  export const MAMMOUTH_DISABLE_FILETIME_CHECK = Config.boolean("MAMMOUTH_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const MAMMOUTH_EXPERIMENTAL_PLAN_MODE = MAMMOUTH_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_PLAN_MODE")
  export const MAMMOUTH_EXPERIMENTAL_WORKSPACES = MAMMOUTH_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_WORKSPACES")
  export const MAMMOUTH_EXPERIMENTAL_MARKDOWN = !falsy("MAMMOUTH_EXPERIMENTAL_MARKDOWN")
  export const MAMMOUTH_MODELS_URL = process.env["MAMMOUTH_MODELS_URL"]
  export const MAMMOUTH_MODELS_PATH = process.env["MAMMOUTH_MODELS_PATH"]
  export const MAMMOUTH_DISABLE_EMBEDDED_WEB_UI = truthy("MAMMOUTH_DISABLE_EMBEDDED_WEB_UI")
  export const MAMMOUTH_DB = process.env["MAMMOUTH_DB"]
  export const MAMMOUTH_DISABLE_CHANNEL_DB = truthy("MAMMOUTH_DISABLE_CHANNEL_DB")
  export const MAMMOUTH_SKIP_MIGRATIONS = truthy("MAMMOUTH_SKIP_MIGRATIONS")
  export const MAMMOUTH_STRICT_CONFIG_DEPS = truthy("MAMMOUTH_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for MAMMOUTH_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "MAMMOUTH_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("MAMMOUTH_DISABLE_PROJECT_CONFIG") || truthy("MAMMOUTH_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for MAMMOUTH_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "MAMMOUTH_TUI_CONFIG", {
  get() {
    return env("MAMMOUTH_TUI_CONFIG", "MAMMOUTH_TUI_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for MAMMOUTH_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "MAMMOUTH_CONFIG_DIR", {
  get() {
    return env("MAMMOUTH_CONFIG_DIR", "MAMMOUTH_CONFIG_DIR")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for MAMMOUTH_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "MAMMOUTH_PURE", {
  get() {
    return truthy("MAMMOUTH_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for MAMMOUTH_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "MAMMOUTH_PLUGIN_META_FILE", {
  get() {
    return process.env["MAMMOUTH_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for MAMMOUTH_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "MAMMOUTH_CLIENT", {
  get() {
    return env("MAMMOUTH_CLIENT", "MAMMOUTH_CLIENT") ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
