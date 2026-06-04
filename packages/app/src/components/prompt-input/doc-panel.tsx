import { Component, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import {
  OPEN_FILE_REFERENCE,
  OPEN_LINE_REFERENCE,
  type OpenFileReferenceDetail,
  type OpenLineReferenceDetail,
} from "@/components/blocksuite/doc-block-events"
import { useLanguage } from "@/context/language"
import { usePromptDocBridge } from "@/context/prompt-doc-bridge"
import type { createPromptDoc } from "./doc"

type PanelProps = {
  doc: ReturnType<typeof createPromptDoc>
}

function theme() {
  const scheme = document.documentElement.getAttribute("data-color-scheme")
  if (scheme === "dark" || scheme === "light") return scheme
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export const PromptDocPanel: Component<PanelProps> = (props) => {
  const language = useLanguage()
  const bridge = usePromptDocBridge()
  const [root, setRoot] = createSignal<HTMLDivElement>()

  onMount(() => {
    const el = root()
    if (!el) return

    const onLine = (event: Event) => {
      const detail = (event as CustomEvent<OpenLineReferenceDetail>).detail
      if (!detail?.path) return
      bridge.openLineReference(detail)
    }
    const onFile = (event: Event) => {
      const detail = (event as CustomEvent<OpenFileReferenceDetail>).detail
      if (!detail?.path) return
      bridge.openFileReference(detail.path, detail.nodeType)
    }

    el.addEventListener(OPEN_LINE_REFERENCE, onLine)
    el.addEventListener(OPEN_FILE_REFERENCE, onFile)

    void props.doc.mount({ el, theme, locale: language.locale })
    onCleanup(() => {
      el.removeEventListener(OPEN_LINE_REFERENCE, onLine)
      el.removeEventListener(OPEN_FILE_REFERENCE, onFile)
      props.doc.detach()
    })
  })

  createEffect(() => {
    theme()
    props.doc.watchTheme()
  })

  return (
    <div
      data-component="prompt-doc"
      class="h-full w-full overflow-hidden bg-transparent"
      ref={setRoot}
      onPointerDown={(e) => {
        e.stopPropagation()
        props.doc.guard()
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
