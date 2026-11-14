import { usePlugin } from "@opencode/plugin/gui"
import { For, onCleanup } from "solid-js"

type Grip = "width" | "height" | "corner"

type Size = { width: number; height: number }

export function ViewportHandles(props: {
  disabled: boolean
  size: Size
  /** Guest CSS pixels per pointer pixel at the current preview and window zoom. */
  ratio: number
  centered: { width: boolean; height: boolean }
  resize: (size: Size) => void
  dragging: (active: boolean) => void
}) {
  const plugin = usePlugin()
  const clamp = (value: number) => Math.max(1, Math.min(4096, Math.round(value)))

  let drag:
    | {
        id: number
        handle: HTMLElement
        x: number
        y: number
        width: number
        height: number
        dx: number
        dy: number
        last: Size
      }
    | undefined

  const start = (event: PointerEvent & { currentTarget: HTMLElement }, grip: Grip) => {
    if (drag || event.button !== 0 || !event.isPrimary) return
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl"

    // Keep the initial scale throughout the drag. Centered previews move both edges.
    drag = {
      id: event.pointerId,
      handle: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      width: props.size.width,
      height: props.size.height,
      dx: grip === "height" ? 0 : props.ratio * (props.centered.width ? 2 : 1) * (rtl ? -1 : 1),
      dy: grip === "width" ? 0 : props.ratio * (props.centered.height ? 2 : 1),
      last: props.size,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    window.addEventListener("blur", end)
    props.dragging(true)
  }

  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    const width = clamp(drag.width + (event.clientX - drag.x) * drag.dx)
    const height = clamp(drag.height + (event.clientY - drag.y) * drag.dy)

    if (width === drag.last.width && height === drag.last.height) return
    drag.last = { width, height }
    props.resize(drag.last)
  }

  const end = () => {
    if (!drag) return
    const { handle, id } = drag
    drag = undefined
    window.removeEventListener("blur", end)

    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id)
    props.dragging(false)
  }

  onCleanup(end)

  const key = (event: KeyboardEvent & { currentTarget: HTMLElement }, grip: Grip) => {
    if (grip === "corner") return
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl"
    const keys = grip === "height" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"]
    const index = keys.indexOf(event.key)

    if (index === -1) return
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    const increase = grip === "width" && rtl ? index === 0 : index === 1
    props.resize({ ...props.size, [grip]: clamp(props.size[grip] + (increase ? step : -step)) })
  }

  return (
    <For each={["width", "height", "corner"] as const}>
      {(grip) => (
        <div
          data-slot="browser-viewport-grip"
          data-axis={grip}
          inert={props.disabled}
          {...(grip === "corner"
            ? { "aria-hidden": true }
            : {
                role: "separator",
                tabIndex: 0,
                "aria-label": plugin.t(grip === "width" ? "viewport.resizeWidth" : "viewport.resizeHeight"),
                "aria-orientation": grip === "width" ? "vertical" : "horizontal",
                "aria-valuemin": 1,
                "aria-valuemax": 4096,
                "aria-valuenow": props.size[grip],
              })}
          onKeyDown={(event) => key(event, grip)}
          onPointerDown={(event) => start(event, grip)}
          onPointerMove={move}
          onPointerUp={(event) => {
            if (event.pointerId !== drag?.id) return
            move(event)
            end()
          }}
          onPointerCancel={(event) => event.pointerId === drag?.id && end()}
          onLostPointerCapture={(event) => event.pointerId === drag?.id && end()}
        />
      )}
    </For>
  )
}
