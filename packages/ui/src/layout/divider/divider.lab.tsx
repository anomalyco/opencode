import { Divider } from "./divider"

const docs = `### Overview
Horizontal hairline divider for v2 layouts.

### API
- Inherits native div attributes.
- Stretches to full width of its flex parent.

### Theming/tokens
- Uses \`data-component="divider-v2"\`.
- Border color: \`--v2-border-border-strong\`.
`

export default {
  title: "UI/Divider",
  id: "ui-divider",
  component: Divider,
  tags: ["autodocs"],
  parameters: {
    frameWidth: "320px",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "16px" }}>
      <span>Above</span>
      <Divider />
      <span>Below</span>
    </div>
  ),
}
