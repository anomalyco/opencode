import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// Flatpak owns updates via the store/host, so the in-app updater is disabled
// inside a sandbox (FLATPAK_ID is set by flatpak for every sandboxed app).
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && !process.env.FLATPAK_ID
