function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const LOTIONCODE_AUTO_SHARE = truthy("LOTIONCODE_AUTO_SHARE")
  export const LOTIONCODE_GIT_BASH_PATH = process.env["LOTIONCODE_GIT_BASH_PATH"]
  export const LOTIONCODE_CONFIG = process.env["LOTIONCODE_CONFIG"]
  export declare const LOTIONCODE_CONFIG_DIR: string | undefined
  export const LOTIONCODE_CONFIG_CONTENT = process.env["LOTIONCODE_CONFIG_CONTENT"]
  export const LOTIONCODE_DISABLE_AUTOUPDATE = truthy("LOTIONCODE_DISABLE_AUTOUPDATE")
  export const LOTIONCODE_DISABLE_PRUNE = truthy("LOTIONCODE_DISABLE_PRUNE")
  export const LOTIONCODE_DISABLE_TERMINAL_TITLE = truthy("LOTIONCODE_DISABLE_TERMINAL_TITLE")
  export const LOTIONCODE_PERMISSION = process.env["LOTIONCODE_PERMISSION"]
  export const LOTIONCODE_DISABLE_DEFAULT_PLUGINS = truthy("LOTIONCODE_DISABLE_DEFAULT_PLUGINS")
  export const LOTIONCODE_DISABLE_LSP_DOWNLOAD = truthy("LOTIONCODE_DISABLE_LSP_DOWNLOAD")
  export const LOTIONCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("LOTIONCODE_ENABLE_EXPERIMENTAL_MODELS")
  export const LOTIONCODE_DISABLE_AUTOCOMPACT = truthy("LOTIONCODE_DISABLE_AUTOCOMPACT")
  export const LOTIONCODE_DISABLE_MODELS_FETCH = truthy("LOTIONCODE_DISABLE_MODELS_FETCH")
  export const LOTIONCODE_DISABLE_CLAUDE_CODE = truthy("LOTIONCODE_DISABLE_CLAUDE_CODE")
  export const LOTIONCODE_DISABLE_CLAUDE_CODE_PROMPT =
    LOTIONCODE_DISABLE_CLAUDE_CODE || truthy("LOTIONCODE_DISABLE_CLAUDE_CODE_PROMPT")
  export const LOTIONCODE_DISABLE_CLAUDE_CODE_SKILLS =
    LOTIONCODE_DISABLE_CLAUDE_CODE || truthy("LOTIONCODE_DISABLE_CLAUDE_CODE_SKILLS")
  export declare const LOTIONCODE_DISABLE_PROJECT_CONFIG: boolean
  export const LOTIONCODE_FAKE_VCS = process.env["LOTIONCODE_FAKE_VCS"]
  export declare const LOTIONCODE_CLIENT: string
  export const LOTIONCODE_SERVER_PASSWORD = process.env["LOTIONCODE_SERVER_PASSWORD"]
  export const LOTIONCODE_SERVER_USERNAME = process.env["LOTIONCODE_SERVER_USERNAME"]

  // Experimental
  export const LOTIONCODE_EXPERIMENTAL = truthy("LOTIONCODE_EXPERIMENTAL")
  export const LOTIONCODE_EXPERIMENTAL_FILEWATCHER = truthy("LOTIONCODE_EXPERIMENTAL_FILEWATCHER")
  export const LOTIONCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("LOTIONCODE_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const LOTIONCODE_EXPERIMENTAL_ICON_DISCOVERY =
    LOTIONCODE_EXPERIMENTAL || truthy("LOTIONCODE_EXPERIMENTAL_ICON_DISCOVERY")
  export const LOTIONCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("LOTIONCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const LOTIONCODE_ENABLE_EXA =
    truthy("LOTIONCODE_ENABLE_EXA") || LOTIONCODE_EXPERIMENTAL || truthy("LOTIONCODE_EXPERIMENTAL_EXA")
  export const LOTIONCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("LOTIONCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const LOTIONCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("LOTIONCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const LOTIONCODE_EXPERIMENTAL_OXFMT = LOTIONCODE_EXPERIMENTAL || truthy("LOTIONCODE_EXPERIMENTAL_OXFMT")
  export const LOTIONCODE_EXPERIMENTAL_LSP_TY = truthy("LOTIONCODE_EXPERIMENTAL_LSP_TY")
  export const LOTIONCODE_EXPERIMENTAL_LSP_TOOL = LOTIONCODE_EXPERIMENTAL || truthy("LOTIONCODE_EXPERIMENTAL_LSP_TOOL")
  export const LOTIONCODE_DISABLE_FILETIME_CHECK = truthy("LOTIONCODE_DISABLE_FILETIME_CHECK")
  export const LOTIONCODE_EXPERIMENTAL_PLAN_MODE = LOTIONCODE_EXPERIMENTAL || truthy("LOTIONCODE_EXPERIMENTAL_PLAN_MODE")
  export const LOTIONCODE_EXPERIMENTAL_MARKDOWN = truthy("LOTIONCODE_EXPERIMENTAL_MARKDOWN")
  export const LOTIONCODE_MODELS_URL = process.env["LOTIONCODE_MODELS_URL"]
  export const LOTIONCODE_MODELS_PATH = process.env["LOTIONCODE_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for LOTIONCODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "LOTIONCODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("LOTIONCODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LOTIONCODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "LOTIONCODE_CONFIG_DIR", {
  get() {
    return process.env["LOTIONCODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LOTIONCODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "LOTIONCODE_CLIENT", {
  get() {
    return process.env["LOTIONCODE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
