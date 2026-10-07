import { createEffect, on, onCleanup } from "solid-js"
import { useLocation } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { dismissToast, showToast } from "@/utils/toast"
import type { VoiceRecorder, VoiceRecordingError } from "./recorder"

export function createVoiceRecovery(recorder: VoiceRecorder) {
  const language = useLanguage()
  const platform = usePlatform()
  const location = useLocation()
  const pending = {
    generation: 0,
    toast: undefined as number | undefined,
    settings: undefined as VoiceRecordingError | undefined,
  }
  const dismiss = () => {
    if (pending.toast !== undefined) dismissToast(pending.toast)
    pending.toast = undefined
  }
  const clear = () => {
    pending.generation++
    pending.settings = undefined
    dismiss()
  }
  const retry = () => {
    clear()
    void recorder.start()
  }
  const status = () =>
    platform.microphone?.status().catch(() => "unknown" as const) ?? Promise.resolve("unknown" as const)
  const canOpen = () => !!platform.microphone && (platform.os === "macos" || platform.os === "windows")
  const permissionDescription = () => {
    if (platform.platform === "web") return language.t("voice.recovery.browser")
    if (platform.os === "macos") return language.t("voice.recovery.macos")
    if (platform.os === "windows") return language.t("voice.recovery.windows")
    return language.t("voice.recovery.system")
  }
  const openSettings = async (error: VoiceRecordingError) => {
    if (!platform.microphone) return
    const generation = ++pending.generation
    pending.settings = error
    const opened = await platform.microphone
      .openSettings(error === "permission" ? "privacy" : "input")
      .catch(() => false)
    if (generation !== pending.generation || opened) return
    pending.settings = undefined
    dismiss()
    pending.toast = showToast({
      title: language.t("voice.recovery.settingsFailed"),
      description: error === "permission" ? permissionDescription() : language.t("voice.recovery.inputManual"),
      persistent: true,
      actions: [{ label: language.t("voice.recovery.retry"), onClick: retry }],
    })
  }
  const show = async (error: VoiceRecordingError) => {
    const generation = ++pending.generation
    const access = error === "permission" ? await status() : "unknown"
    if (generation !== pending.generation) return
    dismiss()
    pending.toast = showToast({
      title: language.t(error === "permission" ? "voice.recovery.permissionTitle" : "voice.error.title"),
      description:
        error !== "permission"
          ? language.t(`voice.error.${error}`)
          : access === "restricted"
            ? language.t("voice.recovery.restricted")
            : platform.os === "macos" && access === "granted"
              ? language.t("voice.recovery.restart")
              : permissionDescription(),
      persistent: true,
      actions: [
        ...(canOpen() && access !== "restricted" && ["permission", "device", "busy"].includes(error)
          ? [
              {
                label: language.t(error === "permission" ? "voice.recovery.openSettings" : "voice.recovery.openInput"),
                onClick: () => void openSettings(error),
              },
            ]
          : []),
        ...(error !== "unsupported" && access !== "restricted"
          ? [{ label: language.t("voice.recovery.retry"), onClick: retry }]
          : []),
      ],
    })
  }
  const refresh = async () => {
    const error = pending.settings
    if (!error || document.visibilityState === "hidden") return
    const generation = ++pending.generation
    const access = await status()
    if (generation !== pending.generation) return
    pending.settings = undefined
    if (error !== "permission" || access !== "granted") return show(error)
    dismiss()
    pending.toast = showToast({
      title: language.t("voice.recovery.allowed"),
      description: platform.os === "macos" ? language.t("voice.recovery.restart") : undefined,
      persistent: true,
      actions: [{ label: language.t("voice.start"), onClick: retry }],
    })
  }
  createEffect(
    on(
      () => recorder.state.error,
      (error) => {
        clear()
        if (error) void show(error)
      },
    ),
  )
  createEffect(on(() => `${location.pathname}${location.search}`, clear, { defer: true }))
  window.addEventListener("focus", refresh)
  document.addEventListener("visibilitychange", refresh)
  onCleanup(() => {
    clear()
    window.removeEventListener("focus", refresh)
    document.removeEventListener("visibilitychange", refresh)
  })
}
