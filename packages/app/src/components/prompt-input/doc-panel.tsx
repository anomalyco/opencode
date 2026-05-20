import { Component, createEffect, onCleanup } from "solid-js"
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
  onCleanup(() => props.doc.detach())

  createEffect(() => {
    theme()
    props.doc.watchTheme()
  })

  return (
    <div
      data-component="prompt-doc"
      class="h-full w-full overflow-hidden bg-transparent"
      ref={(el) => {
        void props.doc.mount({ el, theme })
      }}
    />
  )
}
