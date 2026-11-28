import { InlineInput, type InlineInputProps } from "./inline-input"

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
  args: {
    "aria-label": "Inline value",
    placeholder: "Type...",
    value: "Inline",
    width: "",
    type: "text",
    disabled: false,
    readOnly: false,
  } satisfies InlineInputProps,
  argTypes: { type: { options: ["text", "search", "email", "password", "url", "tel", "number"] } },
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const Basic = {}

export const FixedWidth = { args: { placeholder: "", value: "80px", width: "80px" } }
