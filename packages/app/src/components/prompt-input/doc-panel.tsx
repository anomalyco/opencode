import { Component, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
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
  const [root, setRoot] = createSignal<HTMLDivElement>()

  onMount(() => {
    const el = root()
    if (!el) return
    void props.doc.mount({ el, theme, locale: language.locale })
    onCleanup(() => props.doc.detach())
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
        const target = e.target
        requestAnimationFrame(() => props.doc.refocus(target instanceof Element ? target : undefined))
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
