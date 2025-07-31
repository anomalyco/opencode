export namespace Flag {
  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")
  export const OPENCODE_DISABLE_WATCHER = truthy("OPENCODE_DISABLE_WATCHER")
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase()
    return value === "true" || value === "1"
  }
}
