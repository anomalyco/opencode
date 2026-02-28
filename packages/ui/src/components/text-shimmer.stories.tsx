// @ts-nocheck
import * as mod from "./text-shimmer"
import { useArgs } from "storybook/preview-api"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Animated shimmer effect for loading text placeholders.

Use for pending states inside buttons or list rows.

### API
- Required: \`text\` string.
- Optional: \`as\`, \`active\`, \`stepMs\`, \`durationMs\`, \`swapMs\`, \`offset\`.
- Sweep controls: \`spread\` (band width), \`size\` (travel span), \`angle\`.
- Color controls: \`base\`, \`peak\`.

### Variants and states
- Active/inactive state via \`active\`.

### Behavior
- Uses a moving gradient sweep clipped to text.
- \`offset\` and \`stepMs\` let multiple shimmers run out-of-phase.

### Accessibility
- Uses \`aria-label\` with the full text.

### Theming/tokens
- Uses \`data-component="text-shimmer"\` and CSS custom properties for timing.

`

const defaults = {
  text: "Loading...",
  active: true,
  class: "text-14-medium text-text-strong",
  durationMs: 1200,
  stepMs: 45,
  swapMs: 220,
  spread: 5.2,
  size: 360,
  angle: 90,
  offset: 0,
} as const

const story = create({ title: "UI/TextShimmer", mod, args: defaults })

export default {
  title: "UI/TextShimmer",
  id: "components-text-shimmer",
  component: story.meta.component,
  tags: ["autodocs"],
  args: defaults,
  argTypes: {
    text: { control: "text" },
    class: { control: "text" },
    active: { control: "boolean" },
    durationMs: { control: { type: "range", min: 400, max: 4000, step: 50 } },
    stepMs: { control: { type: "range", min: 0, max: 200, step: 5 } },
    swapMs: { control: { type: "range", min: 0, max: 800, step: 10 } },
    spread: { control: { type: "range", min: 0.3, max: 6, step: 0.1 } },
    size: { control: { type: "range", min: 120, max: 400, step: 5 } },
    angle: { control: { type: "range", min: 0, max: 180, step: 1 } },
    offset: { control: { type: "range", min: 0, max: 80, step: 1 } },
    base: { control: "text" },
    peak: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  args: defaults,
  render: (args) => {
    const [, updateArgs] = useArgs()
    const reset = () => updateArgs(defaults)
    return (
      <div style={{ display: "grid", gap: "12px", "justify-items": "start" }}>
        <mod.TextShimmer {...args} />
        <button
          onClick={reset}
          style={{
            padding: "4px 10px",
            "font-size": "12px",
            "border-radius": "6px",
            border: "1px solid var(--color-divider, #333)",
            background: "var(--color-fill-element, #222)",
            color: "var(--color-text, #eee)",
            cursor: "pointer",
          }}
        >
          Reset controls
        </button>
      </div>
    )
  },
}

export const Inactive = {
  args: {
    text: "Static text",
    active: false,
  },
}

export const CustomTiming = {
  args: {
    text: "Custom timing",
    stepMs: 80,
    durationMs: 1800,
  },
}

export const CustomSweep = {
  args: {
    text: "Custom sweep",
    spread: 2.8,
    size: 280,
    angle: 96,
    durationMs: 1600,
  },
}
