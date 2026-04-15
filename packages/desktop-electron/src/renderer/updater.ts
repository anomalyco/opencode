import { initI18n, t } from "./i18n"

export const UPDATER_ENABLED = () => window.__OPENCODE__?.updaterEnabled ?? false

export async function runUpdater({ alertOnFail }: { alertOnFail: boolean }) {
  await initI18n()
  try {
    await window.api.runUpdater(alertOnFail)
  } catch {
    if (alertOnFail) {
      window.alert(t("desktop.updater.checkFailed.message"))
    }
  }
}
