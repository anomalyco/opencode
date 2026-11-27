import { createSignal, Show, type ParentProps } from "solid-js"
import { Field } from "./field"
import { InlineInput } from "@opencode/ui/inline-input"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"

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

const args = { invalid: false, label: "Label", tooltip: "", prefix: "Prefix", suffix: "Suffix" }

function Example(props: ParentProps<typeof args>) {
  return (
    <div style={{ width: "280px" }}>
      <Field invalid={props.invalid}>
        <Field.Label tooltip={props.tooltip}>{props.label}</Field.Label>
        <Show when={props.prefix}>
          <Field.Prefix>{props.prefix}</Field.Prefix>
        </Show>
        {props.children}
        <Show when={props.suffix}>
          <Field.Suffix>{props.suffix}</Field.Suffix>
        </Show>
      </Field>
    </div>
  )
}

export default {
  title: "UI/Field",
  id: "ui-field",
  args,
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
  args: { tooltip: "Additional context" },
  render: (props: typeof args) => (
    <Example {...props}>
      <Field.Control>
        <TextInput placeholder="Text" showCopyButton />
      </Field.Control>
    </Example>
  ),
}

export const TextInputDirectChild = {
  render: (props: typeof args) => (
    <Example {...props}>
      <TextInput placeholder="Text" />
    </Example>
  ),
}

export const TextareaExample = {
  render: (props: typeof args) => (
    <Example {...props}>
      <Textarea placeholder="Text" />
    </Example>
  ),
}

export const InlineInputExample = {
  render: (props: typeof args) => (
    <Example {...props}>
      <InlineInput placeholder="0.00" width="100%" />
    </Example>
  ),
}

export const Invalid = {
  args: { invalid: true },
  render: (props: typeof args) => (
    <Example {...props}>
      <TextInput placeholder="Text" value="Invalid" showCopyButton />
    </Example>
  ),
}

export const Controlled = {
  args: { label: "Amount", prefix: "" },
  render: (props: typeof args) => {
    const [value, setValue] = createSignal("")

    return (
      <Example {...props} suffix={value() ? `Entered: ${value()}` : props.suffix}>
        <Field.Control>
          <TextInput placeholder="0.00" value={value()} onInput={(e) => setValue(e.currentTarget.value)} numeric />
        </Field.Control>
      </Example>
    )
  },
}
