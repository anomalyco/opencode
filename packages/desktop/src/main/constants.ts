import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"
export const CUSTOM_EDITOR_PATH_KEY = "customEditorPath"
export const DEFAULT_EDITOR_KEY = "defaultEditor"
export const OPENCLAW_CONFIG_KEY = "openclawConfig"
export const GENERICAGENT_CONFIG_KEY = "genericagentConfig"
export const HERMES_CONFIG_KEY = "hermesConfig"
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
