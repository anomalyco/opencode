import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { ask, message } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"

export const UPDATER_ENABLED = window.__OPENCODE__?.updaterEnabled ?? false

export async function runUpdater({ alertOnFail }: { alertOnFail: boolean }) {
  let update
  try {
    update = await check()
  } catch {
    if (alertOnFail) await message("Failed to check for updates", { title: "Update Check Failed" })
    return
  }

  if (!update) {
    if (alertOnFail)
      await message("You are already using the latest version of OpenCode", { title: "No Update Available" })
    return
  }

  try {
    await update.download()
  } catch {
    if (alertOnFail) await message("Failed to download update", { title: "Update Failed" })
    return
  }

  const shouldUpdate = await ask(
    `Version ${update.version} of OpenCode has been downloaded, would you like to install it and relaunch?`,
    { title: "Update Downloaded" },
  )
  if (!shouldUpdate) return

  try {
    if (ostype() === "windows") await invoke("kill_sidecar")
    await update.install()
  } catch {
    await message("Failed to install update", { title: "Update Failed" })
    return
  }

  await invoke("kill_sidecar")
  await relaunch()
}
