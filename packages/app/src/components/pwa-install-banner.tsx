import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { usePlatform } from "@/context/platform"

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed"
    platform: string
  }>
  prompt(): Promise<void>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
    appinstalled: Event
  }
}

export function PwaInstallBanner() {
  const platform = usePlatform()
  const [deferredPrompt, setDeferredPrompt] = createSignal<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = createSignal(false)
  const [isInstalled, setIsInstalled] = createSignal(false)

  onMount(() => {
    if (platform.platform !== "web") return

    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowBanner(true)
    }

    const handleAppInstalled = () => {
      setIsInstalled(true)
      setShowBanner(false)
      setDeferredPrompt(null)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("appinstalled", handleAppInstalled)

    onCleanup(() => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
      window.removeEventListener("appinstalled", handleAppInstalled)
    })
  })

  const handleInstall = async () => {
    const prompt = deferredPrompt()
    if (!prompt) return

    await prompt.prompt()
    const { outcome } = await prompt.userChoice

    if (outcome === "accepted") {
      setShowBanner(false)
    }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShowBanner(false)
    setDeferredPrompt(null)
  }

  return (
    <Show when={showBanner() && !isInstalled()}>
      <div class="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-80">
        <div class="rounded-lg bg-v2-background-bg-base p-4 shadow-[var(--v2-elevation-floating)] border border-v2-border-border-muted">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                class="text-v2-text-text-base"
              >
                <path
                  d="M12 2L2 7L12 12L22 7L12 2Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M2 17L12 22L22 17"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M2 12L12 17L22 12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-[13px] font-[530] text-v2-text-text-base">
                Install OpenCode
              </p>
              <p class="text-[13px] font-[440] text-v2-text-text-muted mt-1">
                Add to your home screen for quick access
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              class="flex-shrink-0 p-1 rounded hover:bg-v2-surface-surface-hover transition-colors"
              aria-label="Dismiss"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                class="text-v2-text-text-muted"
              >
                <path d="M4.25 11.75L11.75 4.25M11.75 11.75L4.25 4.25" stroke="currentColor" />
              </svg>
            </button>
          </div>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleInstall}
              class="flex-1 px-3 py-2 bg-v2-accent-accent text-white text-[13px] font-[530] rounded hover:bg-v2-accent-accent-hover transition-colors"
            >
              Install
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              class="px-3 py-2 text-[13px] font-[530] text-v2-text-text-muted hover:bg-v2-surface-surface-hover rounded transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}