// @ts-nocheck
import { Badge } from "./badge"

const docs = `### Overview
Small label tag for metadata and status chips.

Use alongside headings or lists for quick metadata.

### API
- Accepts standard span props.
- Optional: \`appearance\` is \`compact\` (default) or \`standard\`.
- Optional: \`variant\` is \`neutral\` (default) or \`accent\`.
- Optional: \`data-high-contrast\` attribute for stronger border contrast.

### Variants and states
- Compact and standard appearances; neutral and accent variants.
- Optional high-contrast border style.

### Behavior
- Inline element with fixed 16px height and tabular numeric text.

### Accessibility
- Ensure text conveys meaning; avoid color-only distinction.

### Theming/tokens
- Uses \`data-component="tag"\`.

`

export default {
  title: "UI/Badge",
  id: "ui-badge",
  component: Badge,
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

export const Appearances = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <Badge appearance="standard">Standard</Badge>
      <Badge appearance="compact">Compact</Badge>
    </div>
  ),
}

export const HighContrast = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <Badge>Label</Badge>
      <Badge data-high-contrast>Label</Badge>
    </div>
  ),
}

export const Accent = {
  render: () => <Badge variant="accent">New</Badge>,
}
