// @ts-nocheck
import { createSignal } from "solid-js"
import { RollingResults } from "./rolling-results"

export default {
  title: "UI/RollingResults",
  id: "components-rolling-results",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
A generic rolling feed that shows the latest N rows and animates upward like an odometer.

Built for streaming status lists (reads/searches/lists), but the API is generic via \`items + render\`.
Uses the motion spring helpers from \`components/motion.tsx\` for translate/height transitions.`,
      },
    },
  },
}

const DATA = [
  { kind: "read", text: "Read packages/ui/src/components/message-part.tsx", meta: "offset=1" },
  { kind: "grep", text: 'Search "context-tool-group"', meta: "11 matches" },
  { kind: "glob", text: "Find **/*.stories.tsx", meta: "26 files" },
  { kind: "list", text: "List packages/ui/src/components", meta: "89 entries" },
  { kind: "read", text: "Read packages/ui/src/components/grow-box.tsx", meta: "offset=1" },
  { kind: "grep", text: 'Search "prefers-reduced-motion"', meta: "6 matches" },
  { kind: "read", text: "Read packages/ui/src/components/basic-tool.tsx", meta: "offset=126" },
  { kind: "glob", text: "Find **/*tool*.tsx", meta: "14 files" },
  { kind: "read", text: "Read packages/ui/src/components/motion.tsx", meta: "offset=1" },
]

const btn = (accent?: boolean) =>
  ({
    padding: "6px 12px",
    "border-radius": "6px",
    border: "1px solid var(--border-weaker-base, #343434)",
    background: accent ? "var(--surface-interactive-base, #3a5cff)" : "var(--surface-panel, #1b1b1b)",
    color: "var(--text-strong, #f4f4f4)",
    cursor: "pointer",
    "font-size": "12px",
  }) as const

function row(item: { kind: string; text: string; meta?: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        "align-items": "center",
        width: "100%",
        "min-width": "0",
        "white-space": "nowrap",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          "text-overflow": "ellipsis",
          color: "var(--text-base, #c8c8c8)",
          "font-size": "13px",
        }}
      >
        {item.text}
      </span>
    </div>
  )
}

export const Playground = {
  render: () => {
    const rows = 3
    const [items, setItems] = createSignal<{ id: string; kind: string; text: string; meta?: string }[]>([])
    const [open, setOpen] = createSignal(true)
    const [animate, setAnimate] = createSignal(true)
    const [cursor, setCursor] = createSignal(0)

    const next = () => {
      const index = cursor() % DATA.length
      const id = `row-${cursor()}`
      setItems((prev) => [...prev, { ...DATA[index]!, id }])
      setCursor((value) => value + 1)
    }

    const reset = () => {
      setItems([])
      setCursor(0)
      setOpen(true)
    }

    return (
      <div style={{ padding: "20px", display: "grid", gap: "12px", "max-width": "760px" }}>
        <div style={{ display: "grid", gap: "6px" }}>
          <div style={{ color: "var(--text-strong, #f2f2f2)", "font-size": "14px", "font-weight": "500" }}>
            Circular buffer behavior (3 rows)
          </div>
          <div style={{ color: "var(--text-weaker, #9a9a9a)", "font-size": "12px" }}>
            Click Next: oldest line exits top, newest enters bottom.
          </div>
          <div style={{ color: "var(--text-weaker, #9a9a9a)", "font-size": "12px" }}>
            open: {open() ? "true" : "false"} · rows: {rows} · items:
            {items().length}
          </div>
        </div>

        <RollingResults
          items={items()}
          rows={rows}
          rowGap={0}
          open={open()}
          animate={animate()}
          getKey={(item) => item.id}
          render={row}
        />

        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
          <button style={btn(true)} onClick={next}>
            Next
          </button>
          <button style={btn()} onClick={reset}>
            Clear
          </button>
          <button style={btn()} onClick={() => setOpen((v) => !v)}>
            {open() ? "Collapse" : "Expand"}
          </button>
          <button style={btn()} onClick={() => setAnimate((v) => !v)}>
            {animate() ? "Motion: on" : "Motion: off"}
          </button>
        </div>
      </div>
    )
  },
}

export const StaticTail = {
  render: () => {
    const items = DATA.map((item, index) => ({ ...item, id: `tail-${index}` }))
    return (
      <div style={{ padding: "20px", display: "grid", gap: "10px", "max-width": "760px" }}>
        <div style={{ color: "var(--text-weaker, #9a9a9a)", "font-size": "12px" }}>
          9 items in feed, showing only the last 3 rows.
        </div>
        <div
          style={{
            padding: "2px 0",
          }}
        >
          <RollingResults items={items} rows={3} open animate={false} getKey={(item) => item.id} render={row} />
        </div>
      </div>
    )
  },
}

export const CompactPathOnly = {
  render: () => {
    const items = [
      { id: "1", path: "packages/ui/src/components/message-part.tsx" },
      { id: "2", path: "packages/ui/src/components/tool-count-summary.tsx" },
      { id: "3", path: "packages/ui/src/components/basic-tool.tsx" },
      { id: "4", path: "packages/ui/src/components/grow-box.tsx" },
      { id: "5", path: "packages/ui/src/components/motion.tsx" },
    ]

    return (
      <div style={{ padding: "20px", display: "grid", gap: "10px", "max-width": "760px" }}>
        <div style={{ color: "var(--text-weaker, #9a9a9a)", "font-size": "12px" }}>
          Minimal renderer variant (single text line).
        </div>
        <div
          style={{
            padding: "2px 0",
          }}
        >
          <RollingResults
            items={items}
            rows={4}
            open
            getKey={(item) => item.id}
            render={(item) => (
              <span
                style={{
                  "font-size": "13px",
                  color: "var(--text-base, #c8c8c8)",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                }}
              >
                {item.path}
              </span>
            )}
          />
        </div>
      </div>
    )
  },
}
