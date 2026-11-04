import { app } from "electron"

type Channel = "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

// Application identity uses prod; service discovery keeps the CLI's channel.
export const CHANNEL: Channel =
  raw === "latest" ? "prod" : raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export function serviceChannel() {
  if (process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local") return "local"
  return raw === "local" ? "latest" : raw
}

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}

const appIDs: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "OpenCode Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.opencode.desktop.dev"
