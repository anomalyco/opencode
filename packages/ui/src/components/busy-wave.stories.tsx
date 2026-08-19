import { BusyWave } from "./busy-wave"
import { create } from "../storybook/scaffold"

const docs = `### Overview
TUI-accurate busy indicator: 8 SVG rectangles sweeping bidirectionally with an alpha trail via CSS color-mix().

Use while a session is working.

### API
- Optional: \`color\` (any CSS color, default \`var(--text-weak)\`), \`label\` (aria-label), \`class\`, \`style\`.

### Variants and states
- Colors inherit the active agent color in production.
- Animation pauses under \`prefers-reduced-motion\`.

### Behavior
- 54-frame bidirectional cycle at 40ms per frame: 8 forward, 9-frame hold, 7 backward, 30-frame hold.
- 6-step exponential alpha trail, inactive segments shrink vertically with a fade factor.

### Accessibility
- \`role="status"\` with \`aria-busy="true"\` and \`aria-label\`.
`

const defaults = {
  label: "Thinking",
} as const

const story = create({ title: "UI/BusyWave", mod: { BusyWave }, args: defaults })

export default {
  title: "UI/BusyWave",
  id: "components-busy-wave",
  component: story.meta.component,
  tags: ["autodocs"],
  args: defaults,
  argTypes: {
    color: { control: "color" },
    label: { control: "text" },
    class: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const AgentColor = {
  args: {
    color: "#2090f5",
  },
}

export const StaticLabel = {
  args: {
    label: "Working",
  },
}
