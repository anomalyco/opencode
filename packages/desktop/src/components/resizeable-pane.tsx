import { batch, createContext, createMemo, createSignal, onCleanup, Show, useContext } from "solid-js"
import type { ComponentProps, JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context"

type PaneDefault = number | { size: number; visible?: boolean }

type LayoutContextValue = {
  id: string
  register: (pane: string, options: { min?: number | string; max?: number | string }) => void
  size: (pane: string) => number
  visible: (pane: string) => boolean
  percent: (pane: string) => number
  next: (pane: string) => string | undefined
  startDrag: (left: string, right: string | undefined, event: MouseEvent) => void
  dragging: () => string | undefined
}

const LayoutContext = createContext<LayoutContextValue | undefined>(undefined)

export interface ResizeableLayoutProps {
  id: string
  defaults: Record<string, PaneDefault>
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  children: JSX.Element
}

export interface ResizeablePaneProps {
  id: string
  minSize?: number | string
  maxSize?: number | string
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  children: JSX.Element
}

export function ResizeableLayout(props: ResizeableLayoutProps) {
  const local = useLocal()
  const [meta, setMeta] = createStore<Record<string, { min: number; max: number; minPx?: number; maxPx?: number }>>({})
  const [dragging, setDragging] = createSignal<string>()
  let container: HTMLDivElement | undefined

  local.layout.ensure(props.id, props.defaults)

  const order = createMemo(() => local.layout.order(props.id))
  const visibleOrder = createMemo(() => order().filter((pane) => local.layout.visible(props.id, pane)))
  const totalVisible = createMemo(() => {
    const panes = visibleOrder()
    if (!panes.length) return 0
    return panes.reduce((total, pane) => total + local.layout.size(props.id, pane), 0)
  })

  const percent = (pane: string) => {
    const panes = visibleOrder()
    if (!panes.length) return 0
    const total = totalVisible()
    if (!total) return 100 / panes.length
    return (local.layout.size(props.id, pane) / total) * 100
  }

  const nextPane = (pane: string) => {
    const panes = visibleOrder()
    const index = panes.indexOf(pane)
    if (index === -1) return undefined
    return panes[index + 1]
  }

  const minMax = (pane: string) => meta[pane] ?? { min: 5, max: 95 }

  const pxToPercent = (px: number, total: number) => (px / total) * 100

  const boundsForPair = (left: string, right: string, total: number) => {
    const leftMeta = minMax(left)
    const rightMeta = minMax(right)
    const containerWidth = container?.getBoundingClientRect().width ?? 0

    let minLeft = leftMeta.min
    let maxLeft = leftMeta.max
    let minRight = rightMeta.min
    let maxRight = rightMeta.max

    if (containerWidth && leftMeta.minPx !== undefined) minLeft = pxToPercent(leftMeta.minPx, containerWidth)
    if (containerWidth && leftMeta.maxPx !== undefined) maxLeft = pxToPercent(leftMeta.maxPx, containerWidth)
    if (containerWidth && rightMeta.minPx !== undefined) minRight = pxToPercent(rightMeta.minPx, containerWidth)
    if (containerWidth && rightMeta.maxPx !== undefined) maxRight = pxToPercent(rightMeta.maxPx, containerWidth)

    const finalMinLeft = Math.max(minLeft, total - maxRight)
    const finalMaxLeft = Math.min(maxLeft, total - minRight)
    return {
      min: Math.min(finalMinLeft, finalMaxLeft),
      max: Math.max(finalMinLeft, finalMaxLeft),
    }
  }

  const setPair = (left: string, right: string, leftSize: number, rightSize: number) => {
    batch(() => {
      local.layout.setSize(props.id, left, leftSize)
      local.layout.setSize(props.id, right, rightSize)
    })
  }

  const startDrag = (left: string, right: string | undefined, event: MouseEvent) => {
    if (!right) return
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (!rect.width) return
    event.preventDefault()
    const startX = event.clientX
    const startLeft = local.layout.size(props.id, left)
    const startRight = local.layout.size(props.id, right)
    const total = startLeft + startRight
    const bounds = boundsForPair(left, right, total)
    const move = (moveEvent: MouseEvent) => {
      const delta = ((moveEvent.clientX - startX) / rect.width) * 100
      const nextLeft = Math.max(bounds.min, Math.min(bounds.max, startLeft + delta))
      const nextRight = total - nextLeft
      setPair(left, right, nextLeft, nextRight)
    }
    const stop = () => {
      setDragging()
      document.removeEventListener("mousemove", move)
      document.removeEventListener("mouseup", stop)
    }
    setDragging(left)
    document.addEventListener("mousemove", move)
    document.addEventListener("mouseup", stop)
    onCleanup(() => stop())
  }

  const register = (pane: string, options: { min?: number | string; max?: number | string }) => {
    let min = 5
    let max = 95
    let minPx: number | undefined
    let maxPx: number | undefined

    if (typeof options.min === "string" && options.min.endsWith("px")) {
      minPx = parseInt(options.min)
      min = 0
    } else if (typeof options.min === "number") {
      min = options.min
    }

    if (typeof options.max === "string" && options.max.endsWith("px")) {
      maxPx = parseInt(options.max)
      max = 100
    } else if (typeof options.max === "number") {
      max = options.max
    }

    setMeta(pane, () => ({ min, max, minPx, maxPx }))
    const fallback = props.defaults[pane]
    local.layout.ensurePane(props.id, pane, fallback ?? { size: min, visible: true })
  }

  const contextValue: LayoutContextValue = {
    id: props.id,
    register,
    size: (pane) => local.layout.size(props.id, pane),
    visible: (pane) => local.layout.visible(props.id, pane),
    percent,
    next: nextPane,
    startDrag,
    dragging,
  }

  return (
    <LayoutContext.Provider value={contextValue}>
      <div
        ref={(node) => {
          container = node ?? undefined
        }}
        class={props.class ? `relative flex h-full w-full ${props.class}` : "relative flex h-full w-full"}
        classList={props.classList}
      >
        {props.children}
      </div>
    </LayoutContext.Provider>
  )
}

export function ResizeablePane(props: ResizeablePaneProps) {
  const context = useContext(LayoutContext)!
  context.register(props.id, { min: props.minSize, max: props.maxSize })
  const visible = () => context.visible(props.id)
  const width = () => context.percent(props.id)
  const next = () => context.next(props.id)
  const dragging = () => context.dragging() === props.id

  return (
    <Show when={visible()}>
      <div
        class={props.class ? `relative flex h-full flex-col ${props.class}` : "relative flex h-full flex-col"}
        classList={props.classList}
        style={{
          width: `${width()}%`,
          flex: `0 0 ${width()}%`,
        }}
      >
        {props.children}
        <Show when={next()}>
          <div
            class="absolute top-0 -right-1 h-full w-1.5 cursor-col-resize z-50 group"
            onMouseDown={(event) => context.startDrag(props.id, next(), event)}
          >
            <div
              classList={{
                "w-0.5 h-full bg-transparent transition-colors group-hover:bg-border-active": true,
                "bg-border-active!": dragging(),
              }}
            />
          </div>
        </Show>
      </div>
    </Show>
  )
}
