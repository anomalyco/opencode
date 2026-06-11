import { Show } from "solid-js"
import { useRegisterSW } from "virtual:pwa-register/solid"
import { createPwaUpdateController } from "./pwa-update"

export function PwaUpdatePrompt() {
  const { needRefresh: needRefreshSignal, updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      // Fired asynchronously once the SW detects a waiting update, so the
      // `controller` binding below is always assigned by the time this runs.
      controller.notifyNeedRefresh()
    },
  })
  const [needRefresh] = needRefreshSignal

  const controller = createPwaUpdateController({
    needRefresh,
    // Optional-chained: `updateServiceWorker` may be undefined before the SW
    // registers, so Reload degrades to a no-op rather than throwing.
    update: () => updateServiceWorker?.(true),
  })

  return (
    <Show when={controller.visible()}>
      <div
        role="status"
        aria-label="App update available"
        class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border-base bg-surface-raised-stronger-non-alpha px-4 py-3 text-sm text-text-strong shadow-[var(--shadow-lg-border-base)]"
      >
        <span>A new version is available.</span>
        <button
          type="button"
          class="rounded bg-surface-base px-2 py-1 text-xs font-medium hover:bg-surface-raised-base-hover focus:outline-none"
          onClick={() => controller.reload()}
        >
          Reload
        </button>
        <button
          type="button"
          class="rounded px-2 py-1 text-xs text-text-weak hover:text-text-base focus:outline-none"
          onClick={() => controller.dismiss()}
        >
          Dismiss
        </button>
      </div>
    </Show>
  )
}
