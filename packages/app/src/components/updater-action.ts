import { createMemo } from "solid-js"
import type { MajorUpdateState, UpdaterState } from "@/updater"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useMajorUpdate } from "@/context/major-update"
import { showToast } from "@/utils/toast"

export function updaterAction(state: UpdaterState | undefined, major?: MajorUpdateState["status"]) {
  if (!state) return { label: "settings.updates.action.checkNow" as const }
  switch (state.status) {
    case "checking":
      return { label: "settings.updates.action.checking" as const }
    case "downloading":
      return { label: "settings.updates.action.downloading" as const }
    case "ready":
      return { label: "toast.update.action.installRestart" as const, run: "install" as const }
    case "installing":
      return { label: "settings.updates.action.installing" as const }
    case "disabled":
      return { label: "settings.updates.action.checkNow" as const }
    default:
      // OpenCode 2 downloads once OpenCode 1 is up to date, and a check waits for that download. Another check could
      // only wait with it.
      if (major === "downloading") return { label: "settings.updates.action.downloading" as const }
      return { label: "settings.updates.action.checkNow" as const, run: "check" as const }
  }
}

export function useUpdaterAction() {
  const platform = usePlatform()
  const language = useLanguage()
  const major = useMajorUpdate()
  const action = createMemo(() => updaterAction(platform.updater?.state(), major.status()))

  return {
    action,
    async run() {
      const run = action().run
      if (run === "install") return platform.updater?.install()
      if (run !== "check") return

      const state = await platform.updater?.check()
      // With no OpenCode 1 release left to install, checking for updates opens the OpenCode 2.0 offer instead. The
      // check is run from Settings, which stays open underneath.
      if (state?.status !== "ready" && major.offered()) return major.open({ stack: true })
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
    },
  }
}
