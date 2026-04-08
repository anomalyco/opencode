// @ts-nocheck
import * as mod from "./progress"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Linear progress indicator with optional label and value display.

Use in forms, uploads, or background tasks.

### API
- \`value\` and \`maxValue\` control progress.
- Optional: \`showValueLabel\`, \`hideLabel\`.
- Children provide the label text.

### Variants and states
- Supports indeterminate state via Kobalte props (if provided).

### Behavior
- Uses Kobalte Progress for value calculation.

### Accessibility
- TODO: confirm ARIA attributes from Kobalte.

### Theming/tokens
- Uses \`data-component="progress"\` with track/fill slots.

`

const story = create({
  title: "UI/Progress",
  mod,
  args: {
    value: 60,
    maxValue: 100,
    children: "Progress",
    showValueLabel: true,
  },
})

export default {
  title: "UI/Progress",
  id: "components-progress",
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

export const NoLabel = {
  args: {
    children: "",
    hideLabel: true,
    showValueLabel: false,
    value: 30,
  },
}

export const Indeterminate = {
  render: () => <mod.Progress>Loading</mod.Progress>,
}
