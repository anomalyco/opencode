import path from "path"
import { Global } from "@/global"

export type SessionPref = {
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
}

const prefPath = process.env.OPENCODE_SESSION_PREF_PATH ?? path.join(Global.Path.state, "session-pref.json")
const file = Bun.file(prefPath)

export async function readPrefs(): Promise<Record<string, SessionPref>> {
  return file
    .json()
    .then((data) => (data && typeof data === "object" ? (data as Record<string, SessionPref>) : {}))
    .catch(() => ({}))
}

export async function writePrefs(prefs: Record<string, SessionPref>) {
  await Bun.write(file, JSON.stringify(prefs, null, 2))
}
