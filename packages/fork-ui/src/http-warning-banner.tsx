import { createSignal, onMount, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"

const STORAGE_KEY = "opencode:security-warning-dismissed"

function isLocal(): boolean {
  const hostname = window.location.hostname
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost")
}

function isSecure(): boolean {
  return window.location.protocol === "https:"
}

function shouldShowBanner(): boolean {
  return !isLocal() && !isSecure()
}

export function HttpWarningBanner() {
  const [dismissed, setDismissed] = createSignal(false)

  onMount(() => {
    const dismissedValue = localStorage.getItem(STORAGE_KEY)
    if (dismissedValue === "true") {
      setDismissed(true)
    }
  })

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, "true")
    setDismissed(true)
  }

  return (
    <Show when={!dismissed() && shouldShowBanner()}>
      <div class="w-full bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between px-4 py-2 gap-4">
        <div class="flex items-center gap-2 min-w-0">
          <Icon name="lock-open" size="normal" class="shrink-0 text-amber-600 dark:text-amber-500" />
          <span class="text-14-regular text-text-strong">
            Your connection is not encrypted. Credentials and session data could be intercepted by others on the
            network. For secure access, use HTTPS via a reverse proxy.
          </span>
        </div>
        <IconButton
          icon="close"
          variant="ghost"
          size="normal"
          class="shrink-0"
          onClick={handleDismiss}
          aria-label="Dismiss warning"
        />
      </div>
    </Show>
  )
}
