import { SessionProgressIndicatorV2 } from "./session-progress-indicator-v2"
import { Index } from "solid-js"

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
  title: "OpenCode/Status/Session progress",
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
  args: { size: 16 },
  argTypes: { size: { control: { type: "range", min: 8, max: 48, step: 1 } } },
  render: (args: { size: number }) => <SessionProgressIndicatorV2 width={args.size} height={args.size} />,
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
  args: { count: 16, size: 16 },
  argTypes: { count: { control: { type: "range", min: 1, max: 256, step: 1 } } },
  parameters: {
    layout: "fullscreen",
  },
  render: (args: { count: number; size: number }) => (
    <div
      style={{
        display: "grid",
        width: "100%",
        "max-height": "100%",
        overflow: "auto",
        gap: "4px",
        "grid-template-columns": `repeat(auto-fill, ${args.size}px)`,
        "justify-content": "center",
      }}
    >
      <Index each={Array.from({ length: Math.max(1, Math.min(256, args.count)) })}>
        {() => <SessionProgressIndicatorV2 width={args.size} height={args.size} />}
      </Index>
    </div>
  ),
}

export const OnDark = {
  ...Basic,
  globals: { theme: "dark" },
  render: (args: { size: number }) => (
    <div data-color-scheme="dark" class="rounded-md bg-v2-background-bg-base p-4">
      <SessionProgressIndicatorV2 width={args.size} height={args.size} />
    </div>
  ),
}
