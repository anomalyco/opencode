// @ts-nocheck
import { createSignal, onCleanup } from "solid-js"
import { AnimatedCountList, type CountItem } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"

export default {
  title: "UI/AnimatedCountList",
  id: "components-animated-count-list",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
Animated count list that smoothly transitions items in/out as counts change.

Uses \`grid-template-columns: 0fr → 1fr\` for width animations and the odometer
digit roller for count transitions. Shown here with \`ToolStatusTitle\` exactly
as it appears in the context tool group on the session page.`,
      },
    },
  },
}

const TEXT = {
  active: "Exploring",
  done: "Explored",
  read: { one: "{{count}} read", other: "{{count}} reads" },
  search: { one: "{{count}} search", other: "{{count}} searches" },
  list: { one: "{{count}} list", other: "{{count}} lists" },
} as const

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const btn = (accent?: boolean) =>
  ({
    padding: "6px 14px",
    "border-radius": "6px",
    border: "1px solid var(--color-divider, #333)",
    background: accent ? "var(--color-danger-fill, #c33)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "13px",
  }) as const

const smallBtn = (active?: boolean) =>
  ({
    padding: "4px 12px",
    "border-radius": "6px",
    border: active ? "1px solid var(--color-accent, #58f)" : "1px solid var(--color-divider, #333)",
    background: active ? "var(--color-accent, #58f)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "12px",
  }) as const

export const Playground = {
  render: () => {
    const [reads, setReads] = createSignal(0)
    const [searches, setSearches] = createSignal(0)
    const [lists, setLists] = createSignal(0)
    const [active, setActive] = createSignal(false)
    const [reducedMotion, setReducedMotion] = createSignal(false)

    let timeouts: ReturnType<typeof setTimeout>[] = []

    const clearAll = () => {
      for (const t of timeouts) clearTimeout(t)
      timeouts = []
    }

    onCleanup(clearAll)

    const startSim = () => {
      clearAll()
      setReads(0)
      setSearches(0)
      setLists(0)
      setActive(true)
      const steps = rand(3, 10)
      let elapsed = 0

      for (let i = 0; i < steps; i++) {
        const delay = rand(300, 800)
        elapsed += delay
        const t = setTimeout(() => {
          const pick = rand(0, 2)
          if (pick === 0) setReads((n) => n + 1)
          else if (pick === 1) setSearches((n) => n + 1)
          else setLists((n) => n + 1)
        }, elapsed)
        timeouts.push(t)
      }

      const end = setTimeout(() => setActive(false), elapsed + 100)
      timeouts.push(end)
    }

    const stopSim = () => {
      clearAll()
      setActive(false)
    }

    const reset = () => {
      stopSim()
      setReads(0)
      setSearches(0)
      setLists(0)
    }

    const items = (): CountItem[] => [
      { key: "read", count: reads(), one: TEXT.read.one, other: TEXT.read.other },
      { key: "search", count: searches(), one: TEXT.search.one, other: TEXT.search.other },
      { key: "list", count: lists(), one: TEXT.list.one, other: TEXT.list.other },
    ]

    return (
      <div style={{ display: "grid", gap: "24px", padding: "20px", "max-width": "520px" }}>
        {reducedMotion() && (
          <style>
            {`[data-reduced-motion="true"] *,
              [data-reduced-motion="true"] *::before,
              [data-reduced-motion="true"] *::after {
                transition-duration: 0ms !important;
              }`}
          </style>
        )}

        {/* Matches context-tool-group-trigger layout from message-part.tsx */}
        <span
          data-reduced-motion={reducedMotion()}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            "font-size": "14px",
            "font-weight": "500",
            color: "var(--text-strong, #eee)",
            "min-width": "0",
          }}
        >
          <span style={{ "flex-shrink": "0" }}>
            <ToolStatusTitle active={active()} activeText={TEXT.active} doneText={TEXT.done} split={false} />
          </span>
          <span
            style={{
              "min-width": "0",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
              "font-weight": "400",
              color: "var(--text-base, #ccc)",
            }}
          >
            <AnimatedCountList items={items()} fallback="" />
          </span>
        </span>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <button onClick={() => (active() ? stopSim() : startSim())} style={btn(active())}>
            {active() ? "Stop" : "Simulate"}
          </button>
          <button onClick={reset} style={btn()}>
            Reset
          </button>
          <button onClick={() => setReducedMotion((v) => !v)} style={smallBtn(reducedMotion())}>
            {reducedMotion() ? "Motion: reduced" : "Motion: normal"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <button onClick={() => setReads((n) => n + 1)} style={smallBtn()}>
            + read
          </button>
          <button onClick={() => setSearches((n) => n + 1)} style={smallBtn()}>
            + search
          </button>
          <button onClick={() => setLists((n) => n + 1)} style={smallBtn()}>
            + list
          </button>
        </div>

        <div
          style={{
            "font-size": "11px",
            color: "var(--color-text-weak, #888)",
            "font-family": "monospace",
          }}
        >
          motion: {reducedMotion() ? "reduced" : "normal"} · active: {active() ? "true" : "false"} · reads: {reads()} ·
          searches: {searches()} · lists: {lists()}
        </div>
      </div>
    )
  },
}

export const Empty = {
  render: () => (
    <span style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "14px", "font-weight": "500" }}>
      <ToolStatusTitle active activeText="Exploring" doneText="Explored" split={false} />
      <AnimatedCountList
        items={[
          { key: "read", count: 0, one: "{{count}} read", other: "{{count}} reads" },
          { key: "search", count: 0, one: "{{count}} search", other: "{{count}} searches" },
        ]}
        fallback=""
      />
    </span>
  ),
}

export const Done = {
  render: () => (
    <span style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "14px", "font-weight": "500" }}>
      <ToolStatusTitle active={false} activeText="Exploring" doneText="Explored" split={false} />
      <span style={{ "font-weight": "400", color: "var(--text-base, #ccc)" }}>
        <AnimatedCountList
          items={[
            { key: "read", count: 5, one: "{{count}} read", other: "{{count}} reads" },
            { key: "search", count: 3, one: "{{count}} search", other: "{{count}} searches" },
            { key: "list", count: 1, one: "{{count}} list", other: "{{count}} lists" },
          ]}
          fallback=""
        />
      </span>
    </span>
  ),
}
