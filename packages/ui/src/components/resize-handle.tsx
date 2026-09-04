import { splitProps, type JSX } from "solid-js"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onCollapse?: () => void
  /** Called while dragging when size crosses `collapseThreshold`. */
  onCollapseChange?: (collapsed: boolean) => void
  collapseThreshold?: number
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onCollapse",
    "onCollapseChange",
    "collapseThreshold",
    "class",
    "classList",
  ])

  // Use pointer capture instead of mousedown + document listeners.
  // Without capture the drag silently does nothing in Electron: the handle is
  // correctly positioned and is the topmost element at that point
  // (document.elementFromPoint returns it), and dispatching synthetic
  // mousedown/mousemove/mouseup resizes the panel — but real pointer input
  // never drives it, because the events after the press are not guaranteed to
  // reach this element. setPointerCapture guarantees they do.
  const handlePointerDown = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.detail > 1) return
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    e.preventDefault()
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const start = local.direction === "horizontal" ? e.clientX : e.clientY
    const rtl =
      local.direction === "horizontal" &&
      e.currentTarget instanceof Element &&
      getComputedStyle(e.currentTarget).direction === "rtl"
    const startSize = local.size
    const min = local.min
    const max = local.max
    const threshold = local.collapseThreshold ?? 0
    const onResize = local.onResize
    const onCollapse = local.onCollapse
    const onCollapseChange = local.onCollapseChange
    let current = startSize
    let collapsed = false

    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"

    const onMouseMove = (moveEvent: MouseEvent) => {
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      const delta =
        local.direction === "vertical"
          ? edge === "end"
            ? pos - start
            : start - pos
          : (edge === "start") !== rtl
            ? start - pos
            : pos - start
      current = startSize + delta
      const nextCollapsed = threshold > 0 && current < threshold
      if (nextCollapsed !== collapsed) {
        collapsed = nextCollapsed
        onCollapseChange?.(collapsed)
      }
      onResize(Math.min(max, Math.max(min, current)))
    }

    const onMouseUp = () => {
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      target.releasePointerCapture?.(e.pointerId)
      target.removeEventListener("pointermove", onMouseMove)
      target.removeEventListener("pointerup", onMouseUp)
      target.removeEventListener("pointercancel", onMouseUp)

      if (collapsed) {
        onCollapse?.()
        return
      }
      onCollapseChange?.(false)
    }

    target.addEventListener("pointermove", onMouseMove)
    target.addEventListener("pointerup", onMouseUp)
    target.addEventListener("pointercancel", onMouseUp)
  }

  return (
    <div
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={local.edge ?? (local.direction === "vertical" ? "start" : "end")}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onPointerDown={handlePointerDown}
    />
  )
}
