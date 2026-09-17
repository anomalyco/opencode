import { Splash } from "@opencode/ui/logo"
import { Wordmark } from "@opencode/ui/wordmark"
import type { Platform } from "@opencode/app/desktop"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import "./splash.css"

export function LoadingSplash(props: {
  deep: boolean
  firstLaunch: boolean
  platform: Platform
  preview: boolean
  onDrawEnd: () => void
}) {
  const [drawing, setDrawing] = createStore({ started: false })
  onMount(() => {
    if (!props.preview || !props.firstLaunch) return
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const start = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return
      setDrawing("started", true)
      if (motion.matches) props.onDrawEnd()
    }
    window.addEventListener("focus", start)
    document.addEventListener("visibilitychange", start)
    motion.addEventListener("change", start)
    start()
    onCleanup(() => {
      window.removeEventListener("focus", start)
      document.removeEventListener("visibilitychange", start)
      motion.removeEventListener("change", start)
    })
  })

  const titlebarHeight = () => {
    const zoom = props.platform.webviewZoom?.() ?? 1
    if (props.platform.os === "macos") return `max(36px, ${36 / zoom}px)`
    if (props.platform.os === "windows")
      return `max(36px, env(titlebar-area-height, ${44 / Math.min(Math.max(zoom, 0.25), 1)}px))`
    return "36px"
  }

  return (
    <Show
      when={props.firstLaunch}
      fallback={
        <div
          data-component="startup-splash"
          class="h-dvh w-screen flex flex-col items-center justify-center"
          classList={{
            "bg-v2-background-bg-deep": props.deep,
            "bg-v2-background-bg-base": !props.deep,
          }}
        >
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      <div
        data-component="first-launch-splash"
        data-drawing={props.preview && !drawing.started ? "pending" : "running"}
        aria-hidden="true"
        class="h-dvh w-screen bg-v2-background-bg-base"
        style={{
          // Match the default session's titlebar, panel insets, and wordmark position.
          "padding-block-start": `calc(${titlebarHeight()} + ${props.platform.os === "windows" ? 1 : 8}px)`,
          "padding-block-end": "8px",
          "padding-inline": "32px",
        }}
        onAnimationEnd={(event) => {
          if (event.animationName === "first-launch-wordmark-draw") props.onDrawEnd()
        }}
      >
        <div class="relative size-full">
          <div class="absolute inset-x-0 top-[25.375%]">
            <div class="mx-auto w-full max-w-[720px]">
              <Wordmark
                outline
                fade={false}
                muted={false}
                class="mx-auto block h-auto w-4/5 text-v2-icon-icon-faint opacity-50"
              />
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
