// @ts-nocheck
import { SessionProgressIndicatorV2 } from "./session-progress-indicator-v2"
import { createSignal, onCleanup, onMount } from "solid-js"

const docs = `### Overview
Animated 5×5 dot grid loader for in-progress session state.

Derived from Figma \`_sessionProgressIndicator\` with 8-frame rotation.

### API
- Accepts standard SVG props.

### Behavior
- A shared, pre-rendered alpha mask preserves the smooth opacity changes between 8 key poses (1.2s loop).
- Center dot stays at full opacity throughout the cycle.

### Accessibility
- Sets \`aria-hidden="true"\` by default.

### Theming
- Uses \`currentColor\` via \`--v2-icon-icon-muted\`.
`

export default {
  title: "UI V2/SessionProgressIndicator",
  id: "components-session-progress-indicator-v2",
  component: SessionProgressIndicatorV2,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => <SessionProgressIndicatorV2 />,
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <SessionProgressIndicatorV2 width={12} height={12} />
      <SessionProgressIndicatorV2 />
      <SessionProgressIndicatorV2 width={24} height={24} />
    </div>
  ),
}

export const StressTest = {
  parameters: {
    layout: "fullscreen",
  },
  render: () => <StressGrid />,
}

function StressGrid() {
  const measure = () => ({
    columns: Math.max(1, Math.floor((window.innerWidth + 4) / 20)),
    rows: Math.max(1, Math.floor((window.innerHeight + 4) / 20)),
  })
  const [grid, setGrid] = createSignal(measure())
  const resize = () => setGrid(measure())
  onMount(() => window.addEventListener("resize", resize))
  onCleanup(() => window.removeEventListener("resize", resize))

  return (
    <div
      style={{
        display: "grid",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        gap: "4px",
        "grid-template-columns": `repeat(${grid().columns}, 16px)`,
        "grid-template-rows": `repeat(${grid().rows}, 16px)`,
        "place-content": "center",
      }}
    >
      {Array.from({ length: grid().columns * grid().rows }, () => (
        <SessionProgressIndicatorV2 />
      ))}
    </div>
  )
}

export const OnDark = {
  render: () => (
    <div
      style={{
        display: "flex",
        gap: "16px",
        "align-items": "center",
        padding: "16px",
        "background-color": "#171717",
        color: "#c7c7c7",
      }}
    >
      <SessionProgressIndicatorV2 />
    </div>
  ),
}
