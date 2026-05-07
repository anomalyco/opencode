// @ts-nocheck
import * as mod from "./progress-circle"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Circular progress indicator for compact loading states.

Pair with labels for clarity in dashboards.

### API
- Required: \`percentage\` (0-100).
- Optional: \`size\`, \`strokeWidth\`.

### Variants and states
- Single visual style; size and stroke width adjust appearance.

### Behavior
- Percentage is clamped between 0 and 100.

### Accessibility
- Use alongside text or aria-live messaging for progress context.

### Theming/tokens
- Uses \`data-component="progress-circle"\` with background/progress slots.

`

const story = create({ title: "UI/ProgressCircle", mod, args: { percentage: 65, size: 48 } })

export default {
  title: "UI/ProgressCircle",
  id: "components-progress-circle",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    percentage: {
      control: { type: "range", min: 0, max: 100, step: 1 },
    },
  },
}

export const Basic = story.Basic

export const States = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <mod.ProgressCircle percentage={0} size={32} />
      <mod.ProgressCircle percentage={50} size={32} />
      <mod.ProgressCircle percentage={100} size={32} />
    </div>
  ),
}
