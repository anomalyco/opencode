import { createEffect, createSignal } from "solid-js"
import { Field } from "@opencode/ui/field"
import { Textarea, type TextareaProps } from "./textarea"

const docs = `### Overview
Multiline text field with the same neutral elevation, states, and tokens as TextInput v2.

### API
- Forwards native \`textarea\` props (\`value\`, \`defaultValue\`, \`placeholder\`, \`disabled\`, \`name\`, \`rows\`, etc.).
- \`invalid\`: Error outline and danger text color.
- \`surface\`: \`"base"\` (default) or \`"layer-1"\` for a flat fill.

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
    value: "",
    readOnly: false,
    disabled: false,
    invalid: false,
    rows: 3,
    surface: "base",
  } satisfies TextareaProps,
  argTypes: {
    surface: {
      control: "select",
      options: ["base", "layer-1"],
    },
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

export const Surfaces = {
  parameters: { frameHeight: "700px" },
  args: { placeholder: "Base (default)" },
  render: (args: TextareaProps) => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Textarea {...args} />
      <Textarea surface="layer-1" placeholder="Layer 1" />
      <Textarea surface="layer-1" placeholder="Layer 1, invalid" invalid />
      <Textarea surface="layer-1" placeholder="Layer 1, disabled" disabled />
    </div>
  ),
}

export const Controlled = {
  args: { value: "Controlled value", placeholder: "Type here…" },
  render: (args: TextareaProps) => {
    const [value, setValue] = createSignal("")

    createEffect(() => setValue(String(args.value ?? "")))

    return (
      <div style={{ display: "grid", gap: "12px", width: "280px" }}>
        <Textarea {...args} value={value()} onInput={(e) => setValue(e.currentTarget.value)} />
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
  args: { placeholder: "Text" },
  render: (args: TextareaProps) => (
    <div style={{ display: "grid", gap: "24px", width: "280px" }}>
      <Field invalid={args.invalid}>
        <Field.Label tooltip="Additional context">Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Textarea {...args} />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
      <Field invalid>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Textarea placeholder="Text" value="Invalid value" />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const States = {
  args: { placeholder: "Default" },
  render: (args: TextareaProps) => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Textarea {...args} />
      <Textarea placeholder="With value" value="Hello world" />
      <Textarea placeholder="Invalid" value="Invalid value" invalid />
      <Textarea placeholder="Disabled" disabled />
      <Textarea placeholder="Disabled with value" value="Read only" disabled />
    </div>
  ),
}
