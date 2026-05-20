import { Component, onCleanup, onMount } from "solid-js"
import type { createPromptDrawing } from "./drawing"

type PanelProps = {
  drawing: ReturnType<typeof createPromptDrawing>
}

function theme() {
  const scheme = document.documentElement.getAttribute("data-color-scheme")
  if (scheme === "dark" || scheme === "light") return scheme
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export const PromptDrawingPanel: Component<PanelProps> = (props) => {
  let root: HTMLDivElement | undefined

  onMount(() => {
    if (!root) return
    void props.drawing.mount({ el: root, theme })
  })

  onCleanup(() => props.drawing.dispose())

  return <div data-component="prompt-drawing" ref={root} class="h-full w-full overflow-hidden bg-transparent" />
}
