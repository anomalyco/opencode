function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const WEAPON_AUTO_SHARE = truthy("WEAPON_AUTO_SHARE")
  export const WEAPON_GIT_BASH_PATH = process.env["WEAPON_GIT_BASH_PATH"]
  export const WEAPON_CONFIG = process.env["WEAPON_CONFIG"]
  export declare const WEAPON_CONFIG_DIR: string | undefined
  export declare const WEAPON_CONFIG_CONTENT: string | undefined
  export const WEAPON_DISABLE_AUTOUPDATE = truthy("WEAPON_DISABLE_AUTOUPDATE")
  export const WEAPON_DISABLE_PRUNE = truthy("WEAPON_DISABLE_PRUNE")
  export const WEAPON_DISABLE_TERMINAL_TITLE = truthy("WEAPON_DISABLE_TERMINAL_TITLE")
  export const WEAPON_PERMISSION = process.env["WEAPON_PERMISSION"]
  export const WEAPON_DISABLE_DEFAULT_PLUGINS = truthy("WEAPON_DISABLE_DEFAULT_PLUGINS")
  export const WEAPON_DISABLE_LSP_DOWNLOAD = truthy("WEAPON_DISABLE_LSP_DOWNLOAD")
  export const WEAPON_ENABLE_EXPERIMENTAL_MODELS = truthy("WEAPON_ENABLE_EXPERIMENTAL_MODELS")
  export const WEAPON_DISABLE_AUTOCOMPACT = truthy("WEAPON_DISABLE_AUTOCOMPACT")
  export const WEAPON_DISABLE_MODELS_FETCH = truthy("WEAPON_DISABLE_MODELS_FETCH")
  export const WEAPON_DISABLE_CLAUDE_CODE = truthy("WEAPON_DISABLE_CLAUDE_CODE")
  export const WEAPON_DISABLE_CLAUDE_CODE_PROMPT =
    WEAPON_DISABLE_CLAUDE_CODE || truthy("WEAPON_DISABLE_CLAUDE_CODE_PROMPT")
  export const WEAPON_DISABLE_CLAUDE_CODE_SKILLS =
    WEAPON_DISABLE_CLAUDE_CODE || truthy("WEAPON_DISABLE_CLAUDE_CODE_SKILLS")
  export const WEAPON_DISABLE_EXTERNAL_SKILLS =
    WEAPON_DISABLE_CLAUDE_CODE_SKILLS || truthy("WEAPON_DISABLE_EXTERNAL_SKILLS")
  export declare const WEAPON_DISABLE_PROJECT_CONFIG: boolean
  export const WEAPON_FAKE_VCS = process.env["WEAPON_FAKE_VCS"]
  export declare const WEAPON_CLIENT: string
  export const WEAPON_SERVER_PASSWORD = process.env["WEAPON_SERVER_PASSWORD"]
  export const WEAPON_SERVER_USERNAME = process.env["WEAPON_SERVER_USERNAME"]

  // Experimental
  export const WEAPON_EXPERIMENTAL = truthy("WEAPON_EXPERIMENTAL")
  export const WEAPON_EXPERIMENTAL_FILEWATCHER = truthy("WEAPON_EXPERIMENTAL_FILEWATCHER")
  export const WEAPON_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("WEAPON_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const WEAPON_EXPERIMENTAL_ICON_DISCOVERY =
    WEAPON_EXPERIMENTAL || truthy("WEAPON_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["WEAPON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const WEAPON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("WEAPON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const WEAPON_ENABLE_EXA =
    truthy("WEAPON_ENABLE_EXA") || WEAPON_EXPERIMENTAL || truthy("WEAPON_EXPERIMENTAL_EXA")
  export const WEAPON_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("WEAPON_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const WEAPON_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("WEAPON_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const WEAPON_EXPERIMENTAL_OXFMT = WEAPON_EXPERIMENTAL || truthy("WEAPON_EXPERIMENTAL_OXFMT")
  export const WEAPON_EXPERIMENTAL_LSP_TY = truthy("WEAPON_EXPERIMENTAL_LSP_TY")
  export const WEAPON_EXPERIMENTAL_LSP_TOOL = WEAPON_EXPERIMENTAL || truthy("WEAPON_EXPERIMENTAL_LSP_TOOL")
  export const WEAPON_DISABLE_FILETIME_CHECK = truthy("WEAPON_DISABLE_FILETIME_CHECK")
  export const WEAPON_EXPERIMENTAL_PLAN_MODE = WEAPON_EXPERIMENTAL || truthy("WEAPON_EXPERIMENTAL_PLAN_MODE")
  export const WEAPON_EXPERIMENTAL_MARKDOWN = truthy("WEAPON_EXPERIMENTAL_MARKDOWN")
  export const WEAPON_MODELS_URL = process.env["WEAPON_MODELS_URL"]
  export const WEAPON_MODELS_PATH = process.env["WEAPON_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for WEAPON_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "WEAPON_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("WEAPON_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for WEAPON_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "WEAPON_CONFIG_DIR", {
  get() {
    return process.env["WEAPON_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for WEAPON_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "WEAPON_CLIENT", {
  get() {
    return process.env["WEAPON_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for WEAPON_CONFIG_CONTENT
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "WEAPON_CONFIG_CONTENT", {
  get() {
    return process.env["WEAPON_CONFIG_CONTENT"]
  },
  enumerable: true,
  configurable: false,
})
