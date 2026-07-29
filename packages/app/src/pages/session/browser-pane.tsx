import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform, type BrowserPaneRegistration } from "@/context/platform"

export function SessionBrowserPane(props: { registration: BrowserPaneRegistration }) {
  const platform = usePlatform()
  const dialog = useDialog()
  const [store, setStore] = createStore({
    visible: typeof document === "undefined" || document.visibilityState === "visible",
  })
  let surface: HTMLDivElement | undefined
  let frame: number | undefined
  let until = 0

  const measure = () => {
    frame = undefined
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    const zoom = platform.webviewZoom?.() ?? 1
    const left = Math.round(rect.left * zoom)
    const top = Math.round(rect.top * zoom)
    const right = Math.round(rect.right * zoom)
    const bottom = Math.round(rect.bottom * zoom)
    props.registration.setLayout({
      visible: store.visible && !dialog.active,
      bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    })
    if (performance.now() < until) frame = requestAnimationFrame(measure)
  }

  const schedule = (duration = 0) => {
    until = Math.max(until, performance.now() + duration)
    if (frame !== undefined) return
    frame = requestAnimationFrame(measure)
  }

  createEffect(() => {
    props.registration
    platform.webviewZoom?.()
    dialog.active
    store.visible
    schedule(300)
  })

  onMount(() => {
    const resize = new ResizeObserver(() => schedule())
    if (surface) resize.observe(surface)
    const onResize = () => schedule(300)
    const onVisibility = () => setStore("visible", document.visibilityState === "visible")
    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVisibility)
    schedule(300)
    onCleanup(() => {
      resize.disconnect()
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
      if (frame !== undefined) cancelAnimationFrame(frame)
      props.registration.setLayout()
    })
  })

  return <div ref={surface} class="size-full bg-background-base" />
}
