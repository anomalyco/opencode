import { app } from "electron"
import { isUpdaterEnabled } from "./updater-support"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
export const UPDATER_ENABLED = isUpdaterEnabled({
  isPackaged: app.isPackaged,
  channel: CHANNEL,
  platform: process.platform,
  appImage: process.env.APPIMAGE,
})
