// @ts-nocheck
import { Switch } from "./switch"

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

export default {
  title: "UI/Switch",
  id: "ui-switch",
  component: Switch,
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
  },
}

export const Basic = {}

export const Appearances = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <Switch appearance="standard" defaultChecked>
        Standard
      </Switch>
      <Switch appearance="compact" defaultChecked>
        Compact
      </Switch>
    </div>
  ),
}

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <Switch defaultChecked>Enabled</Switch>
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
