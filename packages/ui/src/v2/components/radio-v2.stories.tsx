// @ts-nocheck
import { createSignal } from "solid-js"
import { RadioGroupV2, RadioItemV2 } from "./radio-v2"

const docs = `### Overview
Single-select options using Kobalte RadioGroup.

### API
- \`RadioGroupV2\` forwards Kobalte RadioGroup props (\`value\`, \`defaultValue\`, \`onChange\`, \`name\`, \`required\`, \`validationState\`, \`disabled\`).
- \`RadioItemV2\` forwards Kobalte item props (\`value\`, \`disabled\`), and adds \`label\` and optional \`description\`.

### Behavior
- Controlled or uncontrolled via \`value\` / \`defaultValue\` on the group (items declare \`value\` only).

### Theming/tokens
- Uses \`data-component="radio-v2"\` and slot attributes.
`

export default {
  title: "UI V2/Radio",
  id: "components-radio-v2",
  component: RadioGroupV2,
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
  render: () => (
    <RadioGroupV2 label="Notification frequency" defaultValue="daily" name="frequency">
      <RadioItemV2 value="daily" label="Daily" description="Once per day at 9am." />
      <RadioItemV2 value="weekly" label="Weekly" description="Every Monday morning." />
      <RadioItemV2 value="never" label="Never" description="No notifications." />
    </RadioGroupV2>
  ),
}

export const Controlled = {
  render: () => {
    const [value, setValue] = createSignal("weekly")
    return (
      <div style={{ display: "grid", gap: "12px" }}>
        <RadioGroupV2 label="Controlled" value={value()} onChange={(v) => setValue(v)} name="controlled-frequency">
          <RadioItemV2 value="daily" label="Daily" />
          <RadioItemV2 value="weekly" label="Weekly" />
          <RadioItemV2 value="never" label="Never" />
        </RadioGroupV2>
        <div style={{ "font-family": "var(--v2-font-family-sans)", "font-size": "12px", color: "#808080" }}>
          Selected: {value()}
        </div>
      </div>
    )
  },
}

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "20px" }}>
      <RadioGroupV2 label="Default" defaultValue="a" name="state-default">
        <RadioItemV2 value="a" label="Option A" />
        <RadioItemV2 value="b" label="Option B" description="Has a description." />
      </RadioGroupV2>

      <RadioGroupV2 label="Disabled group" defaultValue="a" name="state-disabled" disabled>
        <RadioItemV2 value="a" label="Option A" />
        <RadioItemV2 value="b" label="Option B" />
      </RadioGroupV2>

      <RadioGroupV2 label="Disabled item" defaultValue="a" name="state-disabled-item">
        <RadioItemV2 value="a" label="Enabled" />
        <RadioItemV2 value="b" label="Disabled" disabled />
      </RadioGroupV2>

      <RadioGroupV2
        label="Invalid"
        description="Pick one option."
        defaultValue="a"
        name="state-invalid"
        validationState="invalid"
        required
      >
        <RadioItemV2 value="a" label="Option A" />
        <RadioItemV2 value="b" label="Option B" />
      </RadioGroupV2>
    </div>
  ),
}
