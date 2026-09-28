import { createMemo } from "solid-js"
import type { UpdaterState } from "./types"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useUpdaterInstall } from "@/shell/updates/download"

export function updaterAction(state: UpdaterState | undefined) {
  if (!state) return { label: "settings.updates.action.checkNow" as const }
  switch (state.status) {
    case "checking":
      return { label: "settings.updates.action.checking" as const }
    case "downloading":
      return { label: "settings.updates.action.downloading" as const }
    case "ready":
      return { label: "toast.update.action.installRestart" as const, run: "install" as const }
    case "download-required":
      return { label: "settings.updates.action.download" as const, run: "install" as const }
    case "installing":
      return { label: "settings.updates.action.installing" as const }
    case "disabled":
      return { label: "settings.updates.action.checkNow" as const }
    default:
      return { label: "settings.updates.action.checkNow" as const, run: "check" as const }
  }
}

export function useUpdaterAction() {
  const platform = usePlatform()
  const language = useLanguage()
  const install = useUpdaterInstall()
  const action = createMemo(() => updaterAction(platform.updater?.state()))
  const check = async () => {
    const state = await platform.updater?.check()
    if (state?.status === "download-required") {
      install()
      return
    }
    if (state?.status === "up-to-date") {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.updates.toast.latest.title"),
        description: language.t("settings.updates.toast.latest.description", { version: platform.version ?? "" }),
      })
    }
    if (state?.status === "error") {
      showToast({ title: language.t("common.requestFailed"), description: state.message })
    }
  }

  return {
    action,
    check,
    async run() {
      const run = action().run
      if (run === "install") {
        install()
        return
      }
      if (run !== "check") return
      await check()
    },
  }
}
