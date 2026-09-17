// @ts-nocheck
import { SessionProgressIndicatorV2 } from "./session-progress-indicator-v2"

const docs = `### Overview
Animated 5×5 dot grid loader for in-progress session state.

Derived from Figma \`_sessionProgressIndicator\` with 8-frame rotation.

### API
- Accepts standard SVG props.

### Behavior
- CSS keyframes drive per-dot opacity across 8 frames (1.2s loop).
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
