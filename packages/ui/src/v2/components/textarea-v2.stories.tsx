// @ts-nocheck
import { createSignal } from "solid-js"
import { Field as FieldV2 } from "./field-v2"
import { TextareaV2 } from "./textarea-v2"

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
  title: "UI V2/Textarea",
  id: "components-textarea-v2",
  component: TextareaV2,
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
        <TextareaV2 value={value()} onInput={(e) => setValue(e.currentTarget.value)} placeholder="Type here…" />
        <div
          style={{
            "font-family": "var(--font-family-sans)",
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

export const Field = {
  parameters: { frameHeight: "500px" },
  render: () => (
    <div style={{ display: "grid", gap: "24px", width: "280px" }}>
      <FieldV2>
        <FieldV2.Label tooltip="Additional context">Label</FieldV2.Label>
        <FieldV2.Prefix>Prefix</FieldV2.Prefix>
        <TextareaV2 placeholder="Text" />
        <FieldV2.Suffix>Suffix</FieldV2.Suffix>
      </FieldV2>
      <FieldV2 invalid>
        <FieldV2.Label>Label</FieldV2.Label>
        <FieldV2.Prefix>Prefix</FieldV2.Prefix>
        <TextareaV2 placeholder="Text" defaultValue="Invalid value" />
        <FieldV2.Suffix>Suffix</FieldV2.Suffix>
      </FieldV2>
    </div>
  ),
}

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <TextareaV2 placeholder="Default" />
      <TextareaV2 placeholder="With value" defaultValue="Hello world" />
      <TextareaV2 placeholder="Invalid" defaultValue="Invalid value" invalid />
      <TextareaV2 placeholder="Disabled" disabled />
      <TextareaV2 placeholder="Disabled with value" defaultValue="Read only" disabled />
    </div>
  ),
}
