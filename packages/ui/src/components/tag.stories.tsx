// @ts-nocheck
import * as mod from "./tag"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Small label tag for metadata and status chips.

Use alongside headings or lists for quick metadata.

### API
- Optional: \`size\` (normal | large).
- Accepts standard span props.

### Variants and states
- Size variants only.

### Behavior
- Inline element; size controls padding and font size via CSS.

### Accessibility
- Ensure text conveys meaning; avoid color-only distinction.

### Theming/tokens
- Uses \`data-component="tag"\` with size data attributes.

`

const story = create({ title: "UI/Tag", mod, args: { children: "Tag" } })
export default {
  title: "UI/Tag",
  id: "components-tag",
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
    size: {
      control: "select",
      options: ["normal", "large"],
    },
  },
}

export const Basic = story.Basic

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <mod.Tag size="normal">Normal</mod.Tag>
      <mod.Tag size="large">Large</mod.Tag>
    </div>
  ),
}
