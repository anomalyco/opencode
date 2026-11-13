import { createEffect, createSignal } from "solid-js"
import { Switch, type SwitchProps } from "./switch"

const docs = `### Overview
Toggle control for binary settings.

Use in settings panels or forms.

### API
- Uses Kobalte Switch props (\`checked\`, \`defaultChecked\`, \`onChange\`).
- Optional: \`appearance\`, \`hideLabel\`, and \`description\`.
- Children render as the label.

### Variants and states
- Standard and compact appearances; checked/unchecked and disabled states.

### Behavior
- Controlled or uncontrolled usage via Kobalte props.

### Accessibility
- TODO: confirm aria attributes from Kobalte.

### Theming/tokens
- Uses \`data-component="switch"\` and slot attributes.

`

function Sample(props: SwitchProps) {
  const [checked, setChecked] = createSignal(false)

  createEffect(() => setChecked(!!props.defaultChecked))

  return <Switch {...props} checked={checked()} onChange={setChecked} />
}

export default {
  title: "UI/Switch",
  id: "ui-switch",
  component: Switch,
  render: Sample,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    defaultChecked: true,
    children: "Enable notifications",
    description: "",
    appearance: "compact",
    hideLabel: false,
    disabled: false,
    readOnly: false,
    required: false,
    validationState: "valid",
  } satisfies SwitchProps,
  argTypes: {
    appearance: { options: ["standard", "compact"] },
    validationState: { options: ["valid", "invalid"] },
  },
}

export const Basic = {}

export const Appearances = {
  args: { appearance: "standard", children: "Standard" },
  render: (args: SwitchProps) => (
    <div style={{ display: "grid", gap: "12px" }}>
      <Sample {...args} />
      <Switch appearance="compact" defaultChecked>
        Compact
      </Switch>
    </div>
  ),
}

export const States = {
  args: { children: "Enabled" },
  render: (args: SwitchProps) => (
    <div style={{ display: "grid", gap: "12px" }}>
      <Sample {...args} />
      <Switch>Disabled</Switch>
      <Switch disabled>Disabled switch</Switch>
    </div>
  ),
}

export const HiddenLabel = {
  args: {
    children: "Hidden label",
    hideLabel: true,
    defaultChecked: true,
  },
}
