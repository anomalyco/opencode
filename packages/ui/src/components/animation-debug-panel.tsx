import { createSignal } from "solid-js"
import {
  getGrowDuration,
  getCollapsibleDuration,
  setGrowDuration,
  setCollapsibleDuration,
} from "./motion"

export function AnimationDebugPanel() {
  const [grow, setGrow] = createSignal(getGrowDuration())
  const [collapsible, setCollapsible] = createSignal(getCollapsibleDuration())
  const [collapsed, setCollapsed] = createSignal(true)
  const [dragging, setDragging] = createSignal(false)
  const [pos, setPos] = createSignal({ x: 16, y: 16 })
  let dragOffset = { x: 0, y: 0 }

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return
    setDragging(true)
    dragOffset = { x: e.clientX + pos().x, y: e.clientY + pos().y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return
    setPos({ x: dragOffset.x - e.clientX, y: dragOffset.y - e.clientY })
  }

  const onPointerUp = () => setDragging(false)

  return (
    <div
      style={{
        position: "fixed",
        bottom: `${pos().y}px`,
        right: `${pos().x}px`,
        "z-index": "99999",
        background: "rgba(0, 0, 0, 0.85)",
        color: "#e0e0e0",
        "border-radius": "8px",
        "font-family": "monospace",
        "font-size": "12px",
        "box-shadow": "0 4px 20px rgba(0,0,0,0.4)",
        "user-select": "none",
        cursor: dragging() ? "grabbing" : "grab",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "6px 10px",
          "border-bottom": collapsed() ? "none" : "1px solid rgba(255,255,255,0.1)",
          gap: "8px",
        }}
      >
        <span style={{ "font-weight": "bold", "font-size": "11px", opacity: "0.7" }}>
          springs
        </span>
        <button
          style={{
            background: "none",
            border: "none",
            color: "#e0e0e0",
            cursor: "pointer",
            padding: "0 2px",
            "font-size": "14px",
            "line-height": "1",
          }}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed() ? "+" : "\u2013"}
        </button>
      </div>
      {!collapsed() && (
        <div style={{ padding: "8px 10px", display: "flex", "flex-direction": "column", gap: "6px" }}>
          <SliderRow
            label="Grow"
            value={grow()}
            onChange={(v) => {
              setGrow(v)
              setGrowDuration(v)
            }}
          />
          <SliderRow
            label="Collapsible"
            value={collapsible()}
            onChange={(v) => {
              setCollapsible(v)
              setCollapsibleDuration(v)
            }}
          />
        </div>
      )}
    </div>
  )
}

function SliderRow(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
      <span style={{ width: "72px", "font-size": "11px" }}>{props.label}</span>
      <input
        type="range"
        min="0.05"
        max="2.0"
        step="0.05"
        value={props.value}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
        style={{ width: "100px", cursor: "pointer" }}
      />
      <span style={{ width: "32px", "text-align": "right", "font-size": "11px" }}>
        {props.value.toFixed(2)}
      </span>
    </div>
  )
}
