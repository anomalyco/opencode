function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function env(key: string, fallback?: string) {
  return process.env[key] ?? (fallback ? process.env[fallback] : undefined)
}

export namespace Flag {
  export const OPENCODE_AUTO_SHARE = truthy("MAMMOUTH_AUTO_SHARE")
  export const OPENCODE_GIT_BASH_PATH = process.env["MAMMOUTH_GIT_BASH_PATH"]
  export const OPENCODE_CONFIG = env("MAMMOUTH_CONFIG", "OPENCODE_CONFIG")
  export declare const OPENCODE_CONFIG_DIR: string | undefined
  export const OPENCODE_CONFIG_CONTENT = env("MAMMOUTH_CONFIG_CONTENT", "OPENCODE_CONFIG_CONTENT")
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("MAMMOUTH_DISABLE_AUTOUPDATE")
  export const OPENCODE_DISABLE_PRUNE = truthy("MAMMOUTH_DISABLE_PRUNE")
  export const OPENCODE_DISABLE_TERMINAL_TITLE = truthy("MAMMOUTH_DISABLE_TERMINAL_TITLE")
  export const OPENCODE_PERMISSION = process.env["MAMMOUTH_PERMISSION"]
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("MAMMOUTH_DISABLE_DEFAULT_PLUGINS")
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("MAMMOUTH_DISABLE_LSP_DOWNLOAD")
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("MAMMOUTH_ENABLE_EXPERIMENTAL_MODELS")
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy("MAMMOUTH_DISABLE_AUTOCOMPACT")
  export const OPENCODE_DISABLE_MODELS_FETCH = truthy("MAMMOUTH_DISABLE_MODELS_FETCH")
  export const OPENCODE_DISABLE_CLAUDE_CODE = truthy("MAMMOUTH_DISABLE_CLAUDE_CODE")
  export const OPENCODE_DISABLE_CLAUDE_CODE_PROMPT =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("MAMMOUTH_DISABLE_CLAUDE_CODE_PROMPT")
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("MAMMOUTH_DISABLE_CLAUDE_CODE_SKILLS")
  export const OPENCODE_DISABLE_EXTERNAL_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("MAMMOUTH_DISABLE_EXTERNAL_SKILLS")
  export declare const OPENCODE_DISABLE_PROJECT_CONFIG: boolean
  export const OPENCODE_FAKE_VCS = process.env["MAMMOUTH_FAKE_VCS"]
  export declare const OPENCODE_CLIENT: string
  export const OPENCODE_SERVER_PASSWORD = process.env["MAMMOUTH_SERVER_PASSWORD"]
  export const OPENCODE_SERVER_USERNAME = process.env["MAMMOUTH_SERVER_USERNAME"]

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthy("MAMMOUTH_EXPERIMENTAL")
  export const OPENCODE_EXPERIMENTAL_FILEWATCHER = truthy("MAMMOUTH_EXPERIMENTAL_FILEWATCHER")
  export const OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("MAMMOUTH_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const OPENCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OPENCODE_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["MAMMOUTH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("MAMMOUTH_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OPENCODE_ENABLE_EXA =
    truthy("MAMMOUTH_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_EXA")
  export const OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("MAMMOUTH_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("MAMMOUTH_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const OPENCODE_EXPERIMENTAL_OXFMT = OPENCODE_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_OXFMT")
  export const OPENCODE_EXPERIMENTAL_LSP_TY = truthy("MAMMOUTH_EXPERIMENTAL_LSP_TY")
  export const OPENCODE_EXPERIMENTAL_LSP_TOOL = OPENCODE_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_LSP_TOOL")
  export const OPENCODE_DISABLE_FILETIME_CHECK = truthy("MAMMOUTH_DISABLE_FILETIME_CHECK")
  export const OPENCODE_EXPERIMENTAL_PLAN_MODE = OPENCODE_EXPERIMENTAL || truthy("MAMMOUTH_EXPERIMENTAL_PLAN_MODE")
  export const OPENCODE_EXPERIMENTAL_MARKDOWN = truthy("MAMMOUTH_EXPERIMENTAL_MARKDOWN")
  export const OPENCODE_MODELS_URL = env("MAMMOUTH_MODELS_URL", "OPENCODE_MODELS_URL")
  export const OPENCODE_MODELS_PATH = env("MAMMOUTH_MODELS_PATH", "OPENCODE_MODELS_PATH")

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
    return truthy("MAMMOUTH_DISABLE_PROJECT_CONFIG") || truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get() {
    return env("MAMMOUTH_CONFIG_DIR", "OPENCODE_CONFIG_DIR")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "OPENCODE_CLIENT", {
  get() {
    return env("MAMMOUTH_CLIENT", "OPENCODE_CLIENT") ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
