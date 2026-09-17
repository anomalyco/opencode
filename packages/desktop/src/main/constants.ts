import { app } from "electron"

type Channel = "dev" | "beta" | "prod" | "muc"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel =
  raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc" ? raw : "dev"

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
