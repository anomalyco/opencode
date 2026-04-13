import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function createSessionPreview() {
  const sdk = useSDK()
  const sync = useSync()

  const previewUrl = createMemo(() => {
    const path = sync.data.path
    const domain = path?.serveDomain
    const user = path?.jupyterhubUser
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

export function SessionPreviewTabTrigger(props: { src: string | undefined }) {
  const language = useLanguage()
  return (
    <Show when={props.src}>
      <Tabs.Trigger value="preview">
        <div class="flex items-center gap-1.5">
          <div>{language.t("session.tab.preview")}</div>
        </div>
      </Tabs.Trigger>
    </Show>
  )
}

export function SessionPreviewTabContent(props: { src: string | undefined; active: boolean }) {
  return (
    <Show when={props.src}>
      <Tabs.Content value="preview" class="flex flex-col h-full overflow-hidden contain-strict">
        <Show when={props.active}>
          <iframe
            src={props.src}
            class="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </Show>
      </Tabs.Content>
    </Show>
  )
}
