// @ts-nocheck
import { Icon } from "@opencode-ai/ui/icon"
import { Checkbox } from "./checkbox"

const docs = `### Overview
Checkbox control for multi-select or agreement inputs.

### API
- Uses Kobalte Checkbox props.
- Optional: \`hideLabel\`, \`description\`, \`icon\`.
- Children render as the label.

### Theming/tokens
- Uses \`data-component="checkbox"\` and related slots.
`

export default {
  title: "UI/Checkbox",
  id: "ui-checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const Basic = { render: () => <Checkbox defaultChecked>Checkbox</Checkbox> }

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <Checkbox defaultChecked>Checked</Checkbox>
      <Checkbox>Unchecked</Checkbox>
      <Checkbox disabled>Disabled</Checkbox>
      <Checkbox description="Helper text">With description</Checkbox>
    </div>
  ),
}

export const CustomIcon = {
  render: () => (
    <Checkbox icon={<Icon name="check" size="small" />} defaultChecked>
      Custom icon
    </Checkbox>
  ),
}

export const HiddenLabel = { render: () => <Checkbox hideLabel>Hidden label</Checkbox> }
