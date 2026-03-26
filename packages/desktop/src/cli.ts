import { message } from "@tauri-apps/plugin-dialog"

import { initI18n, t } from "./i18n"
import { commands } from "./bindings"

function installError(error: unknown) {
  const text = String(error)
  if (text.includes("CLI installation is only supported on macOS & Linux")) {
    return t("desktop.cli.error.unsupportedPlatform")
  }
  if (text.includes("Sidecar binary not found")) {
    return t("desktop.cli.error.sidecarMissing")
  }
  if (text.includes("Failed to write install script")) {
    return t("desktop.cli.error.scriptWriteFailed")
  }
  if (text.includes("Failed to set script permissions")) {
    return t("desktop.cli.error.scriptPermissionFailed")
  }
  if (text.includes("Failed to run install script")) {
    return t("desktop.cli.error.scriptRunFailed")
  }
  if (text.includes("Install script failed")) {
    return t("desktop.cli.error.scriptFailed")
  }
  if (text.includes("Could not determine install path")) {
    return t("desktop.cli.error.installPathUnknown")
  }
  return text || t("desktop.cli.error.unknown")
}

export async function installCli(): Promise<void> {
  await initI18n()

  try {
    const path = await commands.installCli()
    await message(t("desktop.cli.installed.message", { path }), { title: t("desktop.cli.installed.title") })
  } catch (e) {
    await message(t("desktop.cli.failed.message", { error: installError(e) }), {
      title: t("desktop.cli.failed.title"),
    })
  }
}
