// @ts-nocheck
import { Icon } from "@opencode/ui/icon"
import { Checkbox } from "./checkbox"

const docs = `### Overview
Checkbox control for multi-select or agreement inputs.

### API
- Uses Kobalte Checkbox props.
- Optional: \`hideLabel\`, \`description\`, \`icon\` (standard only).
- Children render as the label.
- \`appearance\`: \`standard\` (default, legacy) or \`compact\`, the design system checkbox.
- \`surface\`: \`base\` (default) or \`layer-1\` for the compact control.

### Theming/tokens
- Standard uses \`data-component="checkbox"\` and related slots.
- Compact uses \`data-slot="checkbox-v2"\` with \`--v2-background-bg-accent\`, \`--v2-border-border-strong\` and \`--v2-state-fg-danger\`.
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

export const Compact = {
  render: () => (
    <div style={{ display: "grid", gap: "16px" }}>
      <Checkbox appearance="compact" description="Suffix">
        Default
      </Checkbox>
      <Checkbox appearance="compact" defaultChecked description="Suffix">
        Checked
      </Checkbox>
      <Checkbox appearance="compact" indeterminate>
        Indeterminate
      </Checkbox>
      <Checkbox appearance="compact" validationState="invalid">
        Invalid
      </Checkbox>
      <Checkbox appearance="compact" disabled description="Suffix">
        Disabled
      </Checkbox>
      <Checkbox appearance="compact" disabled defaultChecked>
        Checked, disabled
      </Checkbox>
      <Checkbox appearance="compact" surface="layer-1">
        Layer 1
      </Checkbox>
    </div>
  ),
}
