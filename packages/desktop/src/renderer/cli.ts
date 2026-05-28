import { initI18n, t } from "./i18n"
import { api } from "./api"

export async function installCli(): Promise<void> {
  await initI18n()

  try {
    const path = await api.installCli()
    window.alert(t("desktop.cli.installed.message", { path }))
  } catch (e) {
    window.alert(t("desktop.cli.failed.message", { error: String(e) }))
  }
}
