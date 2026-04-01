// @ts-nocheck
import * as mod from "./switch"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Toggle control for binary settings.

Use in settings panels or forms.

### API
- Uses Kobalte Switch props (\`checked\`, \`defaultChecked\`, \`onChange\`).
- Optional: \`hideLabel\`, \`description\`.
- Children render as the label.

### Variants and states
- Checked/unchecked, disabled states.

### Behavior
- Controlled or uncontrolled usage via Kobalte props.

### Accessibility
- TODO: confirm aria attributes from Kobalte.

### Theming/tokens
- Uses \`data-component="switch"\` and slot attributes.

`

const story = create({
  title: "UI/Switch",
  mod,
  args: { defaultChecked: true, children: "Enable notifications" },
})

export default {
  title: "UI/Switch",
  id: "components-switch",
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

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <mod.Switch defaultChecked>Enabled</mod.Switch>
      <mod.Switch>Disabled</mod.Switch>
      <mod.Switch disabled>Disabled switch</mod.Switch>
      <mod.Switch description="Optional description">With description</mod.Switch>
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
