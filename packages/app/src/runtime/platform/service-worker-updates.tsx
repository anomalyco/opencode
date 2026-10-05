import { onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { watchServiceWorkerUpdates } from "./service-worker"

/** Whether the component unmounted before the registration was ready, and how to stop watching it. */
type Watch = { disposed: boolean; stop?: () => void }

/** Offers a downloaded build of the web app; the app switches to it only when the user reloads. */
export function ServiceWorkerUpdates() {
  const language = useLanguage()

  onMount(() => {
    const state: Watch = { disposed: false }

    onCleanup(() => {
      state.disposed = true
      state.stop?.()
    })
    void navigator.serviceWorker.ready.then((registration) => {
      if (state.disposed) return
      state.stop = watchServiceWorkerUpdates(registration, (apply) =>
        showToast({
          title: language.t("pwa.update.title"),
          description: language.t("pwa.update.description"),
          persistent: true,
          actions: [
            { label: language.t("pwa.update.reload"), onClick: apply },
            { label: language.t("common.dismiss"), onClick: "dismiss" },
          ],
        }),
      )
    })
  })

  return null
}
