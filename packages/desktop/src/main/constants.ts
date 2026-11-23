import { app } from "electron"
import { resolveIdentity, type Channel } from "./identity"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const identity = resolveIdentity(CHANNEL, app.isPackaged)

export const APP_NAME = identity.appName

export const APP_ID = identity.appID

export const APP_USER_MODEL_ID = identity.appUserModelID
