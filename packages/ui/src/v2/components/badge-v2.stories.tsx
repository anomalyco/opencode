// @ts-nocheck
import { Tag } from "./badge-v2"

const docs = `### Overview
Small label tag for metadata and status chips.

Use alongside headings or lists for quick metadata.

### API
- Accepts standard span props.
- Optional: \`data-high-contrast\` attribute for stronger border contrast.

### Variants and states
- Single size style.
- Optional high-contrast border style.

### Behavior
- Inline element with fixed 16px height and tabular numeric text.

### Accessibility
- Ensure text conveys meaning; avoid color-only distinction.

### Theming/tokens
- Uses \`data-component="tag"\`.

`

export default {
  title: "UI V2/Badge",
  id: "components-badge-v2",
  component: Tag,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    children: "Label",
  },
}

export const Basic = {}

export const HighContrast = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <Tag>Label</Tag>
      <Tag data-high-contrast>Label</Tag>
    </div>
  ),
}
