import { createSignal } from "solid-js"
import { RadioGroup, RadioItem, type RadioGroupProps } from "./radio"

const docs = `### Overview
Single-select options using Kobalte RadioGroup.

### API
- \`RadioGroup\` forwards Kobalte RadioGroup props (\`value\`, \`defaultValue\`, \`onChange\`, \`name\`, \`required\`, \`validationState\`, \`disabled\`).
- \`RadioItem\` forwards Kobalte item props (\`value\`, \`disabled\`), and adds \`label\` and optional \`description\`.

### Behavior
- Controlled or uncontrolled via \`value\` / \`defaultValue\` on the group (items declare \`value\` only).

### Theming/tokens
- Uses \`data-component="radio-v2"\` and slot attributes.
`

export default {
  title: "UI/Radio",
  id: "ui-radio",
  component: RadioGroup,
  args: {
    label: "Notification frequency",
    description: "",
    hideLabel: false,
    disabled: false,
    readOnly: false,
    orientation: "vertical",
    required: false,
    validationState: "valid",
  } satisfies RadioGroupProps,
  argTypes: {
    validationState: { options: ["valid", "invalid"] },
    orientation: { options: ["vertical", "horizontal"] },
  },
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: (args: RadioGroupProps) => (
    <RadioGroup {...args} defaultValue="daily" name="frequency">
      <RadioItem value="daily" label="Daily" description="Once per day at 9am." />
      <RadioItem value="weekly" label="Weekly" description="Every Monday morning." />
      <RadioItem value="never" label="Never" description="No notifications." />
    </RadioGroup>
  ),
}

export const Controlled = {
  args: { label: "Controlled" },
  render: (args: RadioGroupProps) => {
    const [value, setValue] = createSignal("weekly")

    return (
      <div style={{ display: "grid", gap: "12px" }}>
        <RadioGroup {...args} value={value()} onChange={setValue} name="controlled-frequency">
          <RadioItem value="daily" label="Daily" />
          <RadioItem value="weekly" label="Weekly" />
          <RadioItem value="never" label="Never" />
        </RadioGroup>
        <div style={{ "font-family": "var(--v2-font-family-sans)", "font-size": "12px", color: "#808080" }}>
          Selected: {value()}
        </div>
      </div>
    )
  },
}

export const States = {
  args: { label: "Default" },
  render: (args: RadioGroupProps) => (
    <div style={{ display: "grid", gap: "20px" }}>
      <RadioGroup {...args} defaultValue="a" name="state-default">
        <RadioItem value="a" label="Option A" />
        <RadioItem value="b" label="Option B" description="Has a description." />
      </RadioGroup>

      <RadioGroup label="Disabled group" defaultValue="a" name="state-disabled" disabled>
        <RadioItem value="a" label="Option A" />
        <RadioItem value="b" label="Option B" />
      </RadioGroup>

      <RadioGroup label="Disabled item" defaultValue="a" name="state-disabled-item">
        <RadioItem value="a" label="Enabled" />
        <RadioItem value="b" label="Disabled" disabled />
      </RadioGroup>

      <RadioGroup
        label="Invalid"
        description="Pick one option."
        defaultValue="a"
        name="state-invalid"
        validationState="invalid"
        required
      >
        <RadioItem value="a" label="Option A" />
        <RadioItem value="b" label="Option B" />
      </RadioGroup>
    </div>
  ),
}

export const HiddenItemLabels = {
  args: { label: "Notification frequency", description: "Daily or weekly" },
  render: (args: RadioGroupProps) => (
    <RadioGroup {...args} name="hidden-labels">
      <RadioItem value="daily" label="Daily" hideLabel />
      <RadioItem value="weekly" label="Weekly" hideLabel />
    </RadioGroup>
  ),
}
