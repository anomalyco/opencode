// @ts-nocheck
import { InlineInput } from "./inline-input"

const docs = `### Overview
Compact inline input for short values.

### API
- Optional: \`width\` to set a fixed width.
- Accepts standard input props.

### Accessibility
- Provide a label or aria-label when used standalone.

### Theming/tokens
- Uses \`data-component="inline-input"\`.
`

export default {
  title: "UI/InlineInput",
  id: "ui-inline-input",
  component: InlineInput,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const Basic = { args: { placeholder: "Type...", value: "Inline" } }
export const FixedWidth = { args: { value: "80px", width: "80px" } }
