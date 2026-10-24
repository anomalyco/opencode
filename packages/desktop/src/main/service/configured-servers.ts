import log from "electron-log/main.js"
import { getStore } from "../storage/store"
import { createServerSettings } from "./server-settings"

let current: ReturnType<typeof createServerSettings> | undefined

/** One launch snapshot. UI settings writes preserve these keys; changes take effect on next launch. */
export function configuredServers() {
  return (current ??= createServerSettings(getStore(), (message) => log.warn(message))).get()
}
