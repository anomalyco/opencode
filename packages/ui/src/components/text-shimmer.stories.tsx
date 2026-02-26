// @ts-nocheck
import * as mod from "./text-shimmer"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Animated shimmer effect for loading text placeholders.

Use for pending states inside buttons or list rows.

### API
- Required: \`text\` string.
- Optional: \`as\`, \`active\`, \`stepMs\`, \`durationMs\`.

### Variants and states
- Active/inactive state via \`active\`.

### Behavior
- Characters animate with staggered delays.

### Accessibility
- Uses \`aria-label\` with the full text.

### Theming/tokens
- Uses \`data-component="text-shimmer"\` and CSS custom properties for timing.

`

const story = create({ title: "UI/TextShimmer", mod, args: { text: "Loading..." } })

export default {
  title: "UI/TextShimmer",
  id: "components-text-shimmer",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

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
