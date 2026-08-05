import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.LEAKCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
