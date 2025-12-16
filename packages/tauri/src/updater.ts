import { check, DownloadEvent } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { ask, message } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"

export const UPDATER_ENABLED = window.__OPENCODE__?.updaterEnabled ?? false

export async function runUpdater(onDownloadEvent?: (progress: DownloadEvent) => void) {
  let update
  try {
    update = await check()
  } catch {
    await message("Failed to check for updates")
    return false
  }

  if (!update) return
  if (update.version <= update.currentVersion) return

  try {
    await update.download(onDownloadEvent)
  } catch {
    return false
  }

  const shouldUpdate = await ask(
    `Version ${update.version} of OpenCode has been downloaded, would you like to install it and relaunch?`,
  )
  if (!shouldUpdate) return

  try {
    await update.install()
  } catch {
    await message("Failed to install update")
    return false
  }

  await invoke("kill_sidecar")
  await relaunch()

  return true
}
