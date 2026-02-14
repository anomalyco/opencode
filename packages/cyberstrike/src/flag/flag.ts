function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const CYBERSTRIKE_AUTO_SHARE = truthy("CYBERSTRIKE_AUTO_SHARE")
  export const CYBERSTRIKE_GIT_BASH_PATH = process.env["CYBERSTRIKE_GIT_BASH_PATH"]
  export const CYBERSTRIKE_CONFIG = process.env["CYBERSTRIKE_CONFIG"]
  export declare const CYBERSTRIKE_CONFIG_DIR: string | undefined
  export const CYBERSTRIKE_CONFIG_CONTENT = process.env["CYBERSTRIKE_CONFIG_CONTENT"]
  export const CYBERSTRIKE_DISABLE_AUTOUPDATE = truthy("CYBERSTRIKE_DISABLE_AUTOUPDATE")
  export const CYBERSTRIKE_DISABLE_PRUNE = truthy("CYBERSTRIKE_DISABLE_PRUNE")
  export const CYBERSTRIKE_DISABLE_TERMINAL_TITLE = truthy("CYBERSTRIKE_DISABLE_TERMINAL_TITLE")
  export const CYBERSTRIKE_PERMISSION = process.env["CYBERSTRIKE_PERMISSION"]
  export const CYBERSTRIKE_DISABLE_DEFAULT_PLUGINS = truthy("CYBERSTRIKE_DISABLE_DEFAULT_PLUGINS")
  export const CYBERSTRIKE_DISABLE_LSP_DOWNLOAD = truthy("CYBERSTRIKE_DISABLE_LSP_DOWNLOAD")
  export const CYBERSTRIKE_ENABLE_EXPERIMENTAL_MODELS = truthy("CYBERSTRIKE_ENABLE_EXPERIMENTAL_MODELS")
  export const CYBERSTRIKE_DISABLE_AUTOCOMPACT = truthy("CYBERSTRIKE_DISABLE_AUTOCOMPACT")
  export const CYBERSTRIKE_DISABLE_MODELS_FETCH = truthy("CYBERSTRIKE_DISABLE_MODELS_FETCH")
  export const CYBERSTRIKE_DISABLE_CLAUDE_CODE = truthy("CYBERSTRIKE_DISABLE_CLAUDE_CODE")
  export const CYBERSTRIKE_DISABLE_CLAUDE_CODE_PROMPT =
    CYBERSTRIKE_DISABLE_CLAUDE_CODE || truthy("CYBERSTRIKE_DISABLE_CLAUDE_CODE_PROMPT")
  export const CYBERSTRIKE_DISABLE_CLAUDE_CODE_SKILLS =
    CYBERSTRIKE_DISABLE_CLAUDE_CODE || truthy("CYBERSTRIKE_DISABLE_CLAUDE_CODE_SKILLS")
  export const CYBERSTRIKE_DISABLE_EXTERNAL_SKILLS =
    CYBERSTRIKE_DISABLE_CLAUDE_CODE_SKILLS || truthy("CYBERSTRIKE_DISABLE_EXTERNAL_SKILLS")
  export declare const CYBERSTRIKE_DISABLE_PROJECT_CONFIG: boolean
  export const CYBERSTRIKE_FAKE_VCS = process.env["CYBERSTRIKE_FAKE_VCS"]
  export declare const CYBERSTRIKE_CLIENT: string
  export const CYBERSTRIKE_SERVER_PASSWORD = process.env["CYBERSTRIKE_SERVER_PASSWORD"]
  export const CYBERSTRIKE_SERVER_USERNAME = process.env["CYBERSTRIKE_SERVER_USERNAME"]

  // Experimental
  export const CYBERSTRIKE_EXPERIMENTAL = truthy("CYBERSTRIKE_EXPERIMENTAL")
  export const CYBERSTRIKE_EXPERIMENTAL_FILEWATCHER = truthy("CYBERSTRIKE_EXPERIMENTAL_FILEWATCHER")
  export const CYBERSTRIKE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("CYBERSTRIKE_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const CYBERSTRIKE_EXPERIMENTAL_ICON_DISCOVERY =
    CYBERSTRIKE_EXPERIMENTAL || truthy("CYBERSTRIKE_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["CYBERSTRIKE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const CYBERSTRIKE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("CYBERSTRIKE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const CYBERSTRIKE_ENABLE_EXA =
    truthy("CYBERSTRIKE_ENABLE_EXA") || CYBERSTRIKE_EXPERIMENTAL || truthy("CYBERSTRIKE_EXPERIMENTAL_EXA")
  export const CYBERSTRIKE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("CYBERSTRIKE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const CYBERSTRIKE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("CYBERSTRIKE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const CYBERSTRIKE_EXPERIMENTAL_OXFMT = CYBERSTRIKE_EXPERIMENTAL || truthy("CYBERSTRIKE_EXPERIMENTAL_OXFMT")
  export const CYBERSTRIKE_EXPERIMENTAL_LSP_TY = truthy("CYBERSTRIKE_EXPERIMENTAL_LSP_TY")
  export const CYBERSTRIKE_EXPERIMENTAL_LSP_TOOL = CYBERSTRIKE_EXPERIMENTAL || truthy("CYBERSTRIKE_EXPERIMENTAL_LSP_TOOL")
  export const CYBERSTRIKE_DISABLE_FILETIME_CHECK = truthy("CYBERSTRIKE_DISABLE_FILETIME_CHECK")
  export const CYBERSTRIKE_EXPERIMENTAL_PLAN_MODE = CYBERSTRIKE_EXPERIMENTAL || truthy("CYBERSTRIKE_EXPERIMENTAL_PLAN_MODE")
  export const CYBERSTRIKE_EXPERIMENTAL_MARKDOWN = truthy("CYBERSTRIKE_EXPERIMENTAL_MARKDOWN")
  export const CYBERSTRIKE_MODELS_URL = process.env["CYBERSTRIKE_MODELS_URL"]
  export const CYBERSTRIKE_MODELS_PATH = process.env["CYBERSTRIKE_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for CYBERSTRIKE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "CYBERSTRIKE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("CYBERSTRIKE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for CYBERSTRIKE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "CYBERSTRIKE_CONFIG_DIR", {
  get() {
    return process.env["CYBERSTRIKE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for CYBERSTRIKE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "CYBERSTRIKE_CLIENT", {
  get() {
    return process.env["CYBERSTRIKE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
