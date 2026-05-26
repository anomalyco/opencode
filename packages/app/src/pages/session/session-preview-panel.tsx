import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { SessionPreviewFallback } from "./session-preview-fallback"

function createSessionPreview() {
  const sdk = useSDK()
  const sync = useSync()

  const previewUrl = createMemo(() => {
    const env = sync.data.env
    const domain = env?.serveDomain
    const user = env?.jupyterhubUser
    if (!domain || !user) return undefined
    return `https://${user}.${domain}`
  })

  const [previewReady, setPreviewReady] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [reloadCount, setReloadCount] = createSignal(0)

  createEffect(() => {
    const url = previewUrl()
    if (!url) return setPreviewReady(false)

    const ctrl = new AbortController()
    const check = () =>
      fetch(url, { cache: "no-store", mode: "cors", signal: ctrl.signal })
        // Hide only on 503 (service unavailable); show preview for any other status.
        .then((res) => setPreviewReady(res.status !== 503))
        .catch(() => setPreviewReady(true))

    void check()
    const unsubIdle = sdk.event.on("session.idle", () => {
      void check()
      if (dirty()) {
        setReloadCount((n) => n + 1)
        setDirty(false)
      }
    })
    const unsubFile = sdk.event.on("file.watcher.updated", (event) => {
      const file = event.properties.file
      if (file.startsWith(".git/") || file.includes("/.git/")) return
      setDirty(true)
    })

    onCleanup(() => {
      ctrl.abort()
      unsubIdle()
      unsubFile()
    })
  })

  const previewSrc = createMemo(() => {
    if (!previewReady()) return undefined
    const url = previewUrl()
    if (!url) return undefined
    const count = reloadCount()
    if (count === 0) return url
    // Use URL to safely merge reloadCount even if `url` already carries a query.
    // Bumping the param on session.idle changes src so the browser re-navigates
    // the existing iframe — no DOM remount.
    const composed = new URL(url)
    composed.searchParams.set("reloadCount", String(count))
    return composed.toString()
  })

  return { previewSrc }
}

export function SessionPreviewPanel() {
  const { previewSrc } = createSessionPreview()

  return (
    <div data-component="codle-preview-panel" class="flex-1 min-w-0 h-full overflow-hidden">
      <Show when={previewSrc()} fallback={<SessionPreviewFallback />}>
        {(src) => (
          <iframe
            src={src()}
            class="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </Show>
    </div>
  )
}
