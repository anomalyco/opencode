import { TextShimmer } from "./text-shimmer"

type Args = { text: string; active: boolean; offset: number; as: "span" | "div" }

const typography = { "font-size": "13px", "font-weight": "440", "font-family": "var(--font-family-sans)" }

const docs = `### Overview
Animated shimmer effect for loading text placeholders.

### API
- Required: \`text\` string.
- Optional: \`as\`, \`active\`, \`offset\`, \`class\`.

### Behavior
- Uses a moving gradient sweep clipped to text.
- \`offset\` lets multiple shimmers run out-of-phase.

### Accessibility
- Uses \`aria-label\` with the full text.

### Theming
- Uses \`data-component="text-shimmer"\` and CSS custom properties for timing and colors.
`

export default {
  title: "UI/TextShimmer",
  id: "ui-text-shimmer",
  component: TextShimmer,
  tags: ["autodocs"],
  args: { text: "Loading...", active: true, offset: 0, as: "span" },
  argTypes: {
    as: { control: "select", options: ["span", "div"] },
    offset: { control: { type: "range", min: 0, max: 30, step: 1 } },
  },
  render: (args: Args) => (
    <div style={typography}>
      <TextShimmer {...args} />
    </div>
  ),
  parameters: {
    frameBackground: "#fff",
    layout: "padded",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Active = {}

export const Inactive = { args: { text: "Static text", active: false } }

export const WithOffset = {
  args: { text: "First line", offset: 5 },
  render: (args: Args) => (
    <div style={{ ...typography, display: "grid", gap: "8px" }}>
      <TextShimmer {...args} offset={0} />
      <TextShimmer {...args} text="Second line" />
      <TextShimmer {...args} text="Third line" offset={args.offset * 2} />
    </div>
  ),
}
