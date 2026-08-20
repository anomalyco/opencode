// @ts-nocheck
import { createSignal } from "solid-js"
import { Field } from "./field"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { TextInput } from "@opencode-ai/ui/text-input"
import { Textarea } from "@opencode-ai/ui/textarea"

const docs = `### Overview
Composable field layout for TextInput, Textarea, and InlineInput.

### Usage
\`\`\`tsx
<Field invalid>
  <Field.Label tooltip="Helper">Label</Field.Label>
  <Field.Prefix>Prefix</Field.Prefix>
  <Field.Control>
    <TextInput placeholder="Text" />
  </Field.Control>
  <Field.Suffix>Suffix</Field.Suffix>
</Field>
\`\`\`

Omit \`Field.Control\` and place the input directly inside \`Field\` — a11y props are merged automatically.

### API
- \`Field\`: \`invalid\` propagates to the control.
- \`Field.Label\`: \`tooltip\` shows the info icon with tooltip text.
- \`Field.Prefix\` / \`Field.Suffix\`: helper copy above / below the control.
- \`Field.Control\`: optional wrapper (marker only).
`

export default {
  title: "UI/Field",
  id: "ui-field",
  subcomponents: {
    Label: Field.Label,
    Prefix: Field.Prefix,
    Suffix: Field.Suffix,
    Control: Field.Control,
  },
  tags: ["autodocs"],
  parameters: {
    frameHeight: "500px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const TextInputExample = {
  render: () => (
    <div style={{ width: "280px" }}>
      <Field>
        <Field.Label tooltip="Additional context">Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Field.Control>
          <TextInput placeholder="Text" showCopyButton />
        </Field.Control>
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const TextInputDirectChild = {
  render: () => (
    <div style={{ width: "280px" }}>
      <Field>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <TextInput placeholder="Text" />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const TextareaExample = {
  render: () => (
    <div style={{ width: "280px" }}>
      <Field>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Textarea placeholder="Text" />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const InlineInputExample = {
  render: () => (
    <div style={{ width: "280px" }}>
      <Field>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <InlineInput placeholder="0.00" width="100%" />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const Invalid = {
  render: () => (
    <div style={{ width: "280px" }}>
      <Field invalid>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <TextInput placeholder="Text" defaultValue="Invalid" showCopyButton />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const Controlled = {
  render: () => {
    const [value, setValue] = createSignal("")
    return (
      <div style={{ width: "280px" }}>
        <Field>
          <Field.Label>Amount</Field.Label>
          <Field.Control>
            <TextInput placeholder="0.00" value={value()} onInput={(e) => setValue(e.currentTarget.value)} numeric />
          </Field.Control>
          <Field.Suffix>{value() ? `Entered: ${value()}` : "Suffix"}</Field.Suffix>
        </Field>
      </div>
    )
  },
}
