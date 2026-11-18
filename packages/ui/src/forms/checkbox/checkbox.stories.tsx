import { createEffect, createSignal } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Checkbox, type CheckboxProps } from "./checkbox"

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

function Sample(props: CheckboxProps) {
  const [checked, setChecked] = createSignal(false)

  createEffect(() => setChecked(!!props.defaultChecked))

  return <Checkbox {...props} checked={checked()} onChange={setChecked} />
}

export default {
  title: "UI/Checkbox",
  id: "ui-checkbox",
  component: Checkbox,
  render: Sample,
  args: {
    appearance: "standard",
    surface: "base",
    defaultChecked: true,
    indeterminate: false,
    disabled: false,
    readOnly: false,
    required: false,
    validationState: "valid",
    hideLabel: false,
    children: "Checkbox",
    description: "",
  } satisfies CheckboxProps,
  argTypes: {
    appearance: { options: ["standard", "compact"] },
    surface: { options: ["base", "layer-1"] },
    validationState: { options: ["valid", "invalid"] },
  },
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const Basic = {}

export const States = {
  args: { children: "Checked" },
  render: (args: CheckboxProps) => (
    <div style={{ display: "grid", gap: "12px" }}>
      <Sample {...args} />
      <Checkbox>Unchecked</Checkbox>
      <Checkbox disabled>Disabled</Checkbox>
      <Checkbox description="Helper text">With description</Checkbox>
    </div>
  ),
}

export const CustomIcon = {
  args: { children: "Custom icon" },
  render: (args: CheckboxProps) => <Sample {...args} icon={<Icon name="check" size="small" />} />,
}

export const HiddenLabel = { args: { children: "Hidden label", defaultChecked: false, hideLabel: true } }

export const Compact = {
  args: { appearance: "compact", children: "Default", description: "Suffix", defaultChecked: false },
  render: (args: CheckboxProps) => (
    <div style={{ display: "grid", gap: "16px" }}>
      <Sample {...args} />
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
