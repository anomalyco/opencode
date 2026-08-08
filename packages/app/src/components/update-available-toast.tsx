import { onCleanup, onMount } from "solid-js"
import { usePlatform } from "@/context/platform"
import type { useLanguage } from "@/context/language"
import { dismissToast, showToast } from "@/utils/toast"

export function UpdateAvailableToast(props: {
  version: string
  install: () => void
  language: ReturnType<typeof useLanguage>
}) {
  const platform = usePlatform()
  let toastId: number | undefined

  onMount(() => {
    const title = props.language.t("toast.update.title")
    const description = props.language.t("toast.update.description", { version: props.version })

    toastId = showToast({
      persistent: true,
      icon: "download",
      title,
      description,
      actions: [
        {
          label: props.language.t("toast.update.action.installRestart"),
          onClick: props.install,
        },
        {
          label: props.language.t("toast.update.action.notYet"),
          onClick: "dismiss",
        },
      ],
    })

    // Native OS notification while the window is not focused (platform.notify is
    // a no-op when the app is focused, where the toast above is visible instead).
    void platform.notify(title, description, props.install)
  })

  onCleanup(() => {
    if (toastId === undefined) return
    dismissToast(toastId)
  })

  return null
}
