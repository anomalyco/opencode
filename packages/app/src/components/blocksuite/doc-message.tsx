import { Component, createSignal, type JSX, onCleanup, onMount, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { usePromptDocBridge } from "@/context/prompt-doc-bridge"
import {
  OPEN_FILE_REFERENCE,
  OPEN_LINE_REFERENCE,
  type OpenFileReferenceDetail,
  type OpenLineReferenceDetail,
} from "./doc-block-events"
import { createPage } from "./blocksuite-doc"

function theme() {
  const scheme = document.documentElement.getAttribute("data-color-scheme")
  if (scheme === "dark" || scheme === "light") return scheme
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export const DocMessage: Component<{ id: string; fallback?: JSX.Element }> = (props) => {
  const sdk = useSDK()
  const bridge = usePromptDocBridge()
  const [fail, setFail] = createSignal(false)
  let el: HTMLDivElement | undefined
  let page: Awaited<ReturnType<typeof createPage>> | undefined
  let stop = false

  onMount(() => {
    const host = el
    if (!host) {
      setFail(true)
      return
    }

    const onFile = (event: Event) => {
      const detail = (event as CustomEvent<OpenFileReferenceDetail>).detail
      if (!detail?.path) return
      bridge.openFileReference(detail.path, detail.nodeType)
    }
    const onLine = (event: Event) => {
      const detail = (event as CustomEvent<OpenLineReferenceDetail>).detail
      if (!detail?.path) return
      bridge.openLineReference(detail)
    }
    host.addEventListener(OPEN_FILE_REFERENCE, onFile)
    host.addEventListener(OPEN_LINE_REFERENCE, onLine)
    onCleanup(() => {
      host.removeEventListener(OPEN_FILE_REFERENCE, onFile)
      host.removeEventListener(OPEN_LINE_REFERENCE, onLine)
    })

    void createPage({
      theme: theme(),
      init: false,
      readonly: true,
      sync: {
        docID: props.id,
        baseUrl: sdk.url,
        directory: sdk.directory,
        client: sdk.client,
        actorID: "viewer",
        name: "Viewer",
        color: "#3574D9",
      },
    })
      .then(async (next) => {
        if (stop) {
          await next.dispose()
          return
        }
        page = next
        await next.attach(host)
      })
      .catch(() => {
        void page?.dispose()
        page = undefined
        setFail(true)
      })
  })

  onCleanup(() => {
    stop = true
    void page?.dispose()
  })

  return (
    <Show
      when={!fail()}
      fallback={props.fallback ?? <span data-component="prompt-doc-viewer-error">문서를 불러올 수 없습니다.</span>}
    >
      <div ref={el} data-component="prompt-doc-viewer" />
    </Show>
  )
}
