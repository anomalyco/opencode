import { TextShimmer } from "./text-shimmer"

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

export const Active = {
  render: () => (
    <span style={{ "font-size": "13px", "font-weight": "440", "font-family": "Inter, system-ui, sans-serif" }}>
      <TextShimmer text="Loading..." active={true} />
    </span>
  ),
}

export const Inactive = {
  render: () => (
    <span style={{ "font-size": "13px", "font-weight": "440", "font-family": "Inter, system-ui, sans-serif" }}>
      <TextShimmer text="Static text" active={false} />
    </span>
  ),
}

export const WithOffset = {
  render: () => (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        "font-size": "13px",
        "font-weight": "440",
        "font-family": "Inter, system-ui, sans-serif",
      }}
    >
      <TextShimmer text="First line" active={true} offset={0} />
      <TextShimmer text="Second line" active={true} offset={5} />
      <TextShimmer text="Third line" active={true} offset={10} />
    </div>
  ),
}
