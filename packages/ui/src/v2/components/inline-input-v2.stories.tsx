// @ts-nocheck
import { createSignal } from "solid-js"
import { Field as FieldV2 } from "./field-v2"
import { InlineInputV2 } from "./inline-input-v2"

const docs = `### Overview
Single-line field with an inline prefix label, vertical divider, and the same states as TextInput v2.

### API
- \`prefix\`: Inline label in the leading segment (required).
- \`labelWidth\`: Fixed prefix width (px number or CSS length). Omit for fit-content.
- Forwards native \`input\` props (\`value\`, \`defaultValue\`, \`placeholder\`, \`disabled\`, etc.).
- \`showCopyButton\`, \`copyLabel\`, \`onCopyClick\`: Optional trailing copy control.
- \`invalid\`: Error outline and danger text color.
- \`appearance\`: \`"base"\` (28px) or \`"large"\` (32px).
- \`numeric\`: Tabular numerals on prefix and value.

### States
- **Hover**, **Focus**, **Invalid**, **Disabled** — same as TextInput v2 on the outer shell.

### Field
Compose with \`Field\` for label, helper prefix/suffix, and tooltip — see the **Field** story.
`

export default {
  title: "UI V2/InlineInput",
  id: "components-inline-input-v2",
  component: InlineInputV2,
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
    prefix: "Label",
    placeholder: "Text",
    showCopyButton: true,
    disabled: false,
    invalid: false,
    appearance: "base",
  },
  argTypes: {
    prefix: {
      control: "text",
    },
    labelWidth: {
      control: "number",
    },
    appearance: {
      control: "select",
      options: ["base", "large"],
    },
    showCopyButton: {
      control: "boolean",
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
  },
}

export const Playground = {}

export const Controlled = {
  render: () => {
    const [value, setValue] = createSignal("42")
    return (
      <div style={{ display: "grid", gap: "12px", width: "280px" }}>
        <InlineInputV2
          prefix="Amount"
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          placeholder="0.00"
          numeric
        />
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

export const Appearances = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <InlineInputV2 prefix="Label" appearance="base" placeholder="Text" showCopyButton />
      <InlineInputV2 prefix="Label" appearance="large" placeholder="Text" showCopyButton />
      <InlineInputV2 prefix="Label" labelWidth={50} placeholder="Text" showCopyButton />
      <InlineInputV2 prefix="Long label" placeholder="Text" showCopyButton />
    </div>
  ),
}

export const Field = {
  parameters: { frameHeight: "500px" },
  render: () => (
    <div style={{ display: "grid", gap: "24px", width: "280px" }}>
      <FieldV2>
        <FieldV2.Label tooltip="Additional context">Label</FieldV2.Label>
        <FieldV2.Prefix>Prefix</FieldV2.Prefix>
        <InlineInputV2 prefix="USD" placeholder="0.00" numeric showCopyButton />
        <FieldV2.Suffix>Suffix</FieldV2.Suffix>
      </FieldV2>
      <FieldV2 invalid>
        <FieldV2.Label>Label</FieldV2.Label>
        <FieldV2.Prefix>Prefix</FieldV2.Prefix>
        <InlineInputV2 prefix="USD" placeholder="0.00" defaultValue="Invalid" showCopyButton />
        <FieldV2.Suffix>Suffix</FieldV2.Suffix>
      </FieldV2>
    </div>
  ),
}

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <InlineInputV2 prefix="Label" placeholder="Text" showCopyButton />
      <InlineInputV2 prefix="Label" placeholder="Text" defaultValue="Hello" showCopyButton />
      <InlineInputV2 prefix="Label" placeholder="Text" defaultValue="Invalid" invalid showCopyButton />
      <InlineInputV2 prefix="Label" placeholder="Text" disabled showCopyButton />
    </div>
  ),
}
