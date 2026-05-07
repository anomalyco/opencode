// @ts-nocheck
import * as mod from "./inline-input"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Compact inline input for short values.

Use inside text or table rows for quick edits.

### API
- Optional: \`width\` to set a fixed width.
- Accepts standard input props.

### Variants and states
- No built-in variants; style via class or width.

### Behavior
- Uses inline width when provided.

### Accessibility
- Provide a label or aria-label when used standalone.

### Theming/tokens
- Uses \`data-component="inline-input"\`.

`

const story = create({ title: "UI/InlineInput", mod, args: { placeholder: "Type...", value: "Inline" } })
export default {
  title: "UI/InlineInput",
  id: "components-inline-input",
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

export const FixedWidth = {
  args: {
    value: "80px",
    width: "80px",
  },
}
