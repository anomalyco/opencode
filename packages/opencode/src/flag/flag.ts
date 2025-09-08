export namespace Flag {
  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")
  export const OPENCODE_DISABLE_WATCHER = truthy("OPENCODE_DISABLE_WATCHER")
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]
  export const OPENCODE_CONFIG_CONTENT = process.env["OPENCODE_CONFIG_CONTENT"]
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("OPENCODE_DISABLE_AUTOUPDATE")
  export const OPENCODE_PERMISSION = process.env["OPENCODE_PERMISSION"]
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS")
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("OPENCODE_DISABLE_LSP_DOWNLOAD")

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase()
    return value === "true" || value === "1"
  }
}
