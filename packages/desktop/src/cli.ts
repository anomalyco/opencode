import { message } from "@tauri-apps/plugin-dialog"

import { initI18n, t } from "./i18n"
import { commands } from "./bindings"

export async function installCli(): Promise<void> {
  await initI18n()

  try {
    const path = await commands.installCli()
    await message(t("desktop.cli.installed.message", { path }), { title: t("desktop.cli.installed.title") })
  } catch (e) {
    await message(t("desktop.cli.failed.message", { error: String(e) }), { title: t("desktop.cli.failed.title") })
  }
}
