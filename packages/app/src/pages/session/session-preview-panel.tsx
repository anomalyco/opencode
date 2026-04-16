import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

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
  createEffect(() => {
    const url = previewUrl()
    if (!url) return setPreviewReady(false)

    const ctrl = new AbortController()
    const check = () =>
      fetch(url, { cache: "no-store", mode: "cors", signal: ctrl.signal })
        .then((res) => setPreviewReady(res.ok))
        .catch(() => setPreviewReady(false))

    void check()
    const timer = setInterval(check, 10_000)
    const unsub = sdk.event.on("session.idle", () => void check())

    onCleanup(() => {
      ctrl.abort()
      clearInterval(timer)
      unsub()
    })
  })

  const previewSrc = createMemo(() => (previewReady() ? previewUrl() : undefined))

  return { previewSrc }
}

export function SessionPreviewPanel() {
  const { previewSrc } = createSessionPreview()

  return (
    <Show when={previewSrc()}>
      {(src) => (
        <div class="flex-1 min-w-0 h-full bg-background-base border-l border-border-weaker-base">
          <iframe
            src={src()}
            class="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      )}
    </Show>
  )
}
