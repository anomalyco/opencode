// @ts-nocheck
import * as mod from "./text-shimmer"
import { useArgs } from "storybook/preview-api"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Animated shimmer effect for loading text placeholders.

Use for pending states inside buttons or list rows.

### API
- Required: \`text\` string.
- Optional: \`as\`, \`active\`, \`offset\`, \`class\`.

### Variants and states
- Active/inactive state via \`active\`.

### Behavior
- Uses a moving gradient sweep clipped to text.
- \`offset\` lets multiple shimmers run out-of-phase.

### Accessibility
- Uses \`aria-label\` with the full text.

### Theming/tokens
- Uses \`data-component="text-shimmer"\` and CSS custom properties for timing.

`

const defaults = {
  text: "Loading...",
  active: true,
  class: "text-14-medium text-text-strong",
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
    offset: { control: { type: "range", min: 0, max: 80, step: 1 } },
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
