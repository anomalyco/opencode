import { Progress, type ProgressProps } from "./progress"

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

export default {
  title: "UI/Progress",
  id: "components-progress",
  component: Progress,
  render: (args: ProgressProps) => (
    <Progress {...args} class="min-w-48" aria-label={args.children ? undefined : "Progress"} />
  ),
  args: {
    value: 60,
    minValue: 0,
    maxValue: 100,
    children: "Progress",
    indeterminate: false,
    hideLabel: false,
    showValueLabel: true,
  },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100, step: 1 } },
    minValue: { control: { type: "range", min: -100, max: 0, step: 1 } },
    maxValue: { control: { type: "range", min: 1, max: 100, step: 1 } },
  },
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {}

export const NoLabel = {
  args: {
    children: "",
    hideLabel: true,
    showValueLabel: false,
    value: 30,
  },
}

export const Indeterminate = { args: { children: "Loading", indeterminate: true, showValueLabel: false } }
