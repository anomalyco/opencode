import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { usePlayground, type PlaygroundWindow } from "@/context/playground"
import { Preview } from "./preview"

const MIN_WIDTH = 240
const MIN_HEIGHT = 160

export function PlaygroundWindowComponent(props: {
  window: PlaygroundWindow
  canvasRect: () => DOMRect | undefined
  onError?: (id: string, message: string) => void
  onElementSelected?: (selector: string, tagName: string, textContent: string) => void
}) {
  const playground = usePlayground()
  const [dragging, setDragging] = createSignal(false)
  const [resizing, setResizing] = createSignal<string | false>(false)
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0, wx: 0, wy: 0 })
  const [resizeStart, setResizeStart] = createSignal({ x: 0, y: 0, w: 0, h: 0, wx: 0, wy: 0 })

  const selected = createMemo(() => playground.selectedId === props.window.id)

  function startDrag(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return
    e.preventDefault()
    setDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY, wx: props.window.x, wy: props.window.y })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    playground.selectWindow(props.window.id)
  }

  function onDragMove(e: PointerEvent) {
    if (!dragging()) return
    const dx = e.clientX - dragStart().x
    const dy = e.clientY - dragStart().y
    playground.updateWindow(props.window.id, {
      x: dragStart().wx + dx,
      y: dragStart().wy + dy,
    })
  }

  function onDragEnd(e: PointerEvent) {
    setDragging(false)
  }

  function startResize(edge: string, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    setResizing(edge)
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      w: props.window.width,
      h: props.window.height,
      wx: props.window.x,
      wy: props.window.y,
    })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    playground.selectWindow(props.window.id)
  }

  function onResizeMove(e: PointerEvent) {
    const edge = resizing()
    if (!edge) return
    const dx = e.clientX - resizeStart().x
    const dy = e.clientY - resizeStart().y
    const s = resizeStart()
    const patch: Record<string, number> = {}

    if (edge.includes("e")) patch.width = Math.max(MIN_WIDTH, s.w + dx)
    if (edge.includes("s")) patch.height = Math.max(MIN_HEIGHT, s.h + dy)
    if (edge.includes("w")) {
      const nw = Math.max(MIN_WIDTH, s.w - dx)
      patch.width = nw
      patch.x = s.wx + (s.w - nw)
    }
    if (edge.includes("n")) {
      const nh = Math.max(MIN_HEIGHT, s.h - dy)
      patch.height = nh
      patch.y = s.wy + (s.h - nh)
    }

    playground.updateWindow(props.window.id, patch)
  }

  function onResizeEnd() {
    setResizing(false)
  }

  function select(e: MouseEvent) {
    playground.selectWindow(props.window.id)
  }

  const outerStyle = (): JSX.CSSProperties => {
    if (props.window.maximized) {
      return {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%",
        "z-index": `${props.window.zIndex}`,
      }
    }
    if (props.window.minimized) {
      return { display: "none" }
    }
    return {
      position: "absolute",
      left: `${props.window.x}px`,
      top: `${props.window.y}px`,
      width: `${props.window.width}px`,
      height: `${props.window.height}px`,
      "z-index": `${props.window.zIndex}`,
    }
  }

  const modelBadge = () => {
    const id = props.window.model.modelID
    const short = id.split("/").pop()?.split("-").slice(0, 2).join("-") ?? id
    return short.length > 20 ? short.slice(0, 20) + "..." : short
  }

  return (
    <div
      data-component="playground-window"
      data-selected={selected() ? "" : undefined}
      style={outerStyle()}
      class="flex flex-col rounded-lg overflow-hidden shadow-lg border"
      classList={{
        "border-border-strong-base ring-2 ring-blue-500/30": selected(),
        "border-border-weak-base": !selected(),
      }}
      onMouseDown={select}
    >
      {/* Title bar */}
      <div
        class="h-9 shrink-0 flex items-center gap-2 px-3 bg-background-stronger cursor-grab select-none"
        classList={{ "cursor-grabbing": dragging() }}
        onPointerDown={startDrag}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="text-12-medium text-text-base truncate">{props.window.title || "Untitled"}</span>
          <span class="text-10-regular text-text-dimmed-base bg-background-base px-1.5 py-0.5 rounded-full shrink-0">
            {modelBadge()}
          </span>
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
          <Show when={props.window.streaming}>
            <div class="w-2 h-2 rounded-full bg-blue-500 animate-pulse mr-1" />
          </Show>
          <IconButton
            icon="enter"
            variant="ghost"
            class="w-5 h-5"
            onClick={() => playground.refreshWindow(props.window.id)}
          />
          <IconButton
            icon="dash"
            variant="ghost"
            class="w-5 h-5"
            onClick={() => playground.minimizeWindow(props.window.id)}
          />
          <IconButton
            icon="expand"
            variant="ghost"
            class="w-5 h-5"
            onClick={() => playground.maximizeWindow(props.window.id)}
          />
          <IconButton
            icon="close"
            variant="ghost"
            class="w-5 h-5"
            onClick={() => playground.closeWindow(props.window.id)}
          />
        </div>
      </div>

      {/* Content area */}
      <div class="flex-1 relative overflow-hidden bg-white">
        <Preview
          window={props.window}
          onError={(msg) => props.onError?.(props.window.id, msg)}
          onElementSelected={props.onElementSelected}
        />
        <Show when={props.window.error}>
          <div class="absolute bottom-0 left-0 right-0 bg-red-50 border-t border-red-200 px-3 py-2 flex items-center gap-2">
            <span class="text-11-regular text-red-700 truncate flex-1">{props.window.error}</span>
            <button
              class="text-11-medium text-red-600 hover:text-red-800 shrink-0 underline"
              onClick={() => playground.updateWindow(props.window.id, { error: undefined })}
            >
              Dismiss
            </button>
          </div>
        </Show>
      </div>

      {/* Resize handles */}
      <Show when={!props.window.maximized}>
        <ResizeEdge edge="e" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
        <ResizeEdge edge="s" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
        <ResizeEdge edge="w" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
        <ResizeEdge edge="n" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
        <ResizeEdge edge="se" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
        <ResizeEdge edge="sw" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
        <ResizeEdge edge="ne" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
        <ResizeEdge edge="nw" onStart={startResize} onMove={onResizeMove} onEnd={onResizeEnd} />
      </Show>
    </div>
  )
}

function ResizeEdge(props: {
  edge: string
  onStart: (edge: string, e: PointerEvent) => void
  onMove: (e: PointerEvent) => void
  onEnd: () => void
}) {
  const cursor = () => {
    switch (props.edge) {
      case "n":
      case "s":
        return "ns-resize"
      case "e":
      case "w":
        return "ew-resize"
      case "ne":
      case "sw":
        return "nesw-resize"
      case "nw":
      case "se":
        return "nwse-resize"
      default:
        return "default"
    }
  }

  const position = (): Record<string, string> => {
    const base: Record<string, string> = { position: "absolute" }
    const size = "6px"
    const corner = "8px"

    switch (props.edge) {
      case "n":
        return { ...base, top: "0", left: corner, right: corner, height: size }
      case "s":
        return { ...base, bottom: "0", left: corner, right: corner, height: size }
      case "e":
        return { ...base, right: "0", top: corner, bottom: corner, width: size }
      case "w":
        return { ...base, left: "0", top: corner, bottom: corner, width: size }
      case "ne":
        return { ...base, top: "0", right: "0", width: corner, height: corner }
      case "nw":
        return { ...base, top: "0", left: "0", width: corner, height: corner }
      case "se":
        return { ...base, bottom: "0", right: "0", width: corner, height: corner }
      case "sw":
        return { ...base, bottom: "0", left: "0", width: corner, height: corner }
      default:
        return base
    }
  }

  return (
    <div
      style={{ ...position(), cursor: cursor(), "z-index": "10" }}
      onPointerDown={(e) => props.onStart(props.edge, e)}
      onPointerMove={props.onMove}
      onPointerUp={props.onEnd}
    />
  )
}
