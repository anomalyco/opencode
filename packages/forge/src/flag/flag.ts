export namespace Flag {
  export const FORGE_AUTO_SHARE = truthy("FORGE_AUTO_SHARE")
  export const FORGE_CONFIG = process.env["FORGE_CONFIG"]
  export const FORGE_CONFIG_DIR = process.env["FORGE_CONFIG_DIR"]
  export const FORGE_CONFIG_CONTENT = process.env["FORGE_CONFIG_CONTENT"]
  export const FORGE_DISABLE_AUTOUPDATE = truthy("FORGE_DISABLE_AUTOUPDATE")
  export const FORGE_DISABLE_PRUNE = truthy("FORGE_DISABLE_PRUNE")
  export const FORGE_PERMISSION = process.env["FORGE_PERMISSION"]
  export const FORGE_DISABLE_PLUGINS = truthy("FORGE_DISABLE_PLUGINS")
  export const FORGE_DISABLE_DEFAULT_PLUGINS = truthy("FORGE_DISABLE_DEFAULT_PLUGINS")
  export const FORGE_DISABLE_LSP_DOWNLOAD = truthy("FORGE_DISABLE_LSP_DOWNLOAD")
  export const FORGE_ENABLE_EXPERIMENTAL_MODELS = truthy("FORGE_ENABLE_EXPERIMENTAL_MODELS")
  export const FORGE_DISABLE_AUTOCOMPACT = truthy("FORGE_DISABLE_AUTOCOMPACT")
  export const FORGE_FAKE_VCS = process.env["FORGE_FAKE_VCS"]
  export const FORGE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH =
    process.env["FORGE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH"]

  // Experimental
  export const FORGE_EXPERIMENTAL = truthy("FORGE_EXPERIMENTAL")
  export const FORGE_EXPERIMENTAL_WATCHER = FORGE_EXPERIMENTAL || truthy("FORGE_EXPERIMENTAL_WATCHER")
  export const FORGE_EXPERIMENTAL_EXA = FORGE_EXPERIMENTAL || truthy("FORGE_EXPERIMENTAL_EXA")

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase()
    return value === "true" || value === "1"
  }
}
