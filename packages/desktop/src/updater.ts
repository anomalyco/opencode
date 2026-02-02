import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { ask, message } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"

import { initI18n, t } from "./i18n"

export const UPDATER_ENABLED = window.__OPENCODE__?.updaterEnabled ?? false

export async function runUpdater({ alertOnFail }: { alertOnFail: boolean }) {
  await initI18n()

  let update
  try {
    update = await check()
  } catch {
    if (alertOnFail)
      await message(t("desktop.updater.checkFailed.message"), { title: t("desktop.updater.checkFailed.title") })
    return
  }

  if (!update) {
    if (alertOnFail) await message(t("desktop.updater.none.message"), { title: t("desktop.updater.none.title") })
    return
  }

  try {
    await update.download()
  } catch {
    if (alertOnFail)
      await message(t("desktop.updater.downloadFailed.message"), { title: t("desktop.updater.downloadFailed.title") })
    return
  }

  const shouldUpdate = await ask(t("desktop.updater.downloaded.prompt", { version: update.version }), {
    title: t("desktop.updater.downloaded.title"),
  })
  if (!shouldUpdate) return

  try {
    if (ostype() === "windows") await invoke("kill_sidecar")
    await update.install()
  } catch {
    await message(t("desktop.updater.installFailed.message"), { title: t("desktop.updater.installFailed.title") })
    return
  }

  await invoke("kill_sidecar")
  await relaunch()
}
