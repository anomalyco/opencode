// @ts-nocheck
import { createSignal } from "solid-js"
import { Field } from "@opencode-ai/ui/field"
import { Textarea } from "./textarea"

const docs = `### Overview
Multiline text field with the same neutral elevation, states, and tokens as TextInput v2.

### API
- Forwards native \`textarea\` props (\`value\`, \`defaultValue\`, \`placeholder\`, \`disabled\`, \`name\`, \`rows\`, etc.).
- \`invalid\`: Error outline and danger text color.

### States
- **Hover**: neutral overlay on the raised surface.
- **Focus** (\`:focus-within\`): focus outline, elevation removed.
- **Invalid**: danger outline and text.
- **Disabled**: 50% opacity.

### Field
Compose with \`Field\` for label, helper prefix/suffix, and tooltip — see the **Field** story.
`

export default {
  title: "UI/Textarea",
  id: "ui-textarea",
  component: Textarea,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "400px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    placeholder: "Placeholder",
    disabled: false,
    invalid: false,
    rows: 3,
  },
  argTypes: {
    disabled: {
      control: "boolean",
    },
    invalid: {
      control: "boolean",
    },
    placeholder: {
      control: "text",
    },
    rows: {
      control: { type: "number", min: 1, max: 12 },
    },
  },
}

export const Playground = {}

export const Controlled = {
  render: () => {
    const [value, setValue] = createSignal("Controlled value")
    return (
      <div style={{ display: "grid", gap: "12px", width: "280px" }}>
        <Textarea value={value()} onInput={(e) => setValue(e.currentTarget.value)} placeholder="Type here…" />
        <div
          style={{
            "font-family": "var(--v2-font-family-sans)",
            "font-size": "12px",
            color: "var(--text-text-faint)",
          }}
        >
          Value: {value()}
        </div>
      </div>
    )
  },
}

export const WithField = {
  parameters: { frameHeight: "500px" },
  render: () => (
    <div style={{ display: "grid", gap: "24px", width: "280px" }}>
      <Field>
        <Field.Label tooltip="Additional context">Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Textarea placeholder="Text" />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
      <Field invalid>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Textarea placeholder="Text" defaultValue="Invalid value" />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Textarea placeholder="Default" />
      <Textarea placeholder="With value" defaultValue="Hello world" />
      <Textarea placeholder="Invalid" defaultValue="Invalid value" invalid />
      <Textarea placeholder="Disabled" disabled />
      <Textarea placeholder="Disabled with value" defaultValue="Read only" disabled />
    </div>
  ),
}
