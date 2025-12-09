import { check, DownloadEvent } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { ask, message } from "@tauri-apps/plugin-dialog"

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

  const shouldUpdate = await ask(`Version ${update.version} of OpenCode is available, would you like to install it?`)
  if (!shouldUpdate) return

  try {
    await update.install()
  } catch {
    await message("Failed to install update")
    return false
  }

  const shouldRestart = await ask("Update installed successfully, would you like to restart OpenCode?")
  if (shouldRestart) await relaunch()

  return true
}
