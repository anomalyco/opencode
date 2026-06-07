import { app } from "electron"
export { DEFAULT_SERVER_URL_KEY, PINCH_ZOOM_ENABLED_KEY, SETTINGS_STORE, WSL_SERVERS_KEY } from "./store-keys"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
