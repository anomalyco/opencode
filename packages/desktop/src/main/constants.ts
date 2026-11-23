import { app } from "electron"
import { resolveIdentity, type Channel } from "./identity"

const raw = import.meta.env.OPENCODE_CHANNEL

// Application identity uses prod; service discovery keeps the CLI's channel.
export const CHANNEL: Channel =
  raw === "latest" ? "prod" : raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export function serviceChannel() {
  if (process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local") return "local"
  return raw === "local" ? "latest" : raw
}

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const identity = resolveIdentity(CHANNEL, app.isPackaged)

export const APP_NAME = identity.appName

export const APP_ID = identity.appID

export const APP_USER_MODEL_ID = identity.appUserModelID
