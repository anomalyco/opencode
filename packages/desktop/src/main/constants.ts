type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.CEDRIC_CHANNEL ?? import.meta.env.OPENKIMI_CHANNEL ?? import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const SETTINGS_STORE = "cedric.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_SERVERS_KEY = "wslServers"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"
export const UPDATER_ENABLED = false
