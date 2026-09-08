import { createEffect, onCleanup } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEventListener } from "@solid-primitives/event-listener"
import { useDialog } from "@opencode/ui/context/dialog"
import { useDesktopExtensions } from "./provider"

/** Native geometry, clipping and portal occlusion are host behavior shared by all extensions. */
export function ExtensionNativeSurface(props: { extensionID: string; id: string }) {
  const host = useDesktopExtensions()
  const dialog = useDialog()
  let surface: HTMLDivElement | undefined
  let frame: number | undefined
  let until = 0
  let last = ""
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })
  const measure = () => {
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    const covered = Array.from(document.querySelectorAll('[data-popper-positioner]:not(:has([role="tooltip"]))')).some(
      (element) => {
        const other = element.getBoundingClientRect()
        return (
          other.width > 0 &&
          other.left < rect.right &&
          other.right > rect.left &&
          other.top < rect.bottom &&
          other.bottom > rect.top
        )
      },
    )
    const zoom = host.zoom()
    const visible =
      document.visibilityState === "visible" &&
      !dialog.active &&
      !covered &&
      surface.checkVisibility({ checkVisibilityCSS: true })
    const color = getComputedStyle(
      surface.closest(".bg-v2-background-bg-deep") ?? document.documentElement,
    ).backgroundColor
    const key = `${props.id}:${visible}:${rect.x}:${rect.y}:${rect.width}:${rect.height}:${zoom}:${color}:${devicePixelRatio}`
    if (key === last) return
    last = key
    if (paint) {
      paint.clearRect(0, 0, 1, 1)
      paint.fillStyle = color
      paint.fillRect(0, 0, 1, 1)
    }
    const rgba = paint?.getImageData(0, 0, 1, 1).data
    host.transport?.surface(props.extensionID, props.id, {
      visible,
      bounds: {
        x: Math.round(rect.left * zoom),
        y: Math.round(rect.top * zoom),
        width: Math.max(0, Math.round(rect.right * zoom) - Math.round(rect.left * zoom)),
        height: Math.max(0, Math.round(rect.bottom * zoom) - Math.round(rect.top * zoom)),
      },
      background: rgba ? [rgba[0], rgba[1], rgba[2], rgba[3]] : undefined,
      radius: Math.round(10 * zoom),
    })
  }
  const tick = () => {
    frame = undefined
    measure()
    if (performance.now() < until) frame = requestAnimationFrame(tick)
  }
  const schedule = () => {
    until = performance.now() + 300
    if (frame === undefined) frame = requestAnimationFrame(tick)
  }
  createEffect(() => {
    props.id
    dialog.active
    host.zoom()
    schedule()
  })
  createResizeObserver(() => surface, measure)
  createEventListener(window, "resize", schedule)
  createEventListener(document, "visibilitychange", schedule)
  const portals = new MutationObserver(schedule)
  portals.observe(document.body, { childList: true })
  const theme = new MutationObserver(schedule)
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] })
  onCleanup(() => {
    portals.disconnect()
    theme.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
    host.transport?.surface(props.extensionID, props.id)
  })
  return <div ref={surface} data-component="native-surface" class="min-h-0 min-w-0 flex-1 bg-v2-background-bg-base" />
}
