// @ts-nocheck
import { createSignal } from "solid-js"
import { Field } from "@opencode-ai/ui/field"
import { TextInput } from "./text-input"

const docs = `### Overview
Compact single-line text field with neutral elevation, optional trailing copy action, and theme tokens.

### API
- Forwards native \`input\` props (\`value\`, \`defaultValue\`, \`placeholder\`, \`disabled\`, \`name\`, \`type\`, etc.).
- \`showCopyButton\`: Renders the trailing outline-copy control.
- \`copyLabel\`: Accessible name for the copy button (default: "Copy").
- \`onCopyClick\`: Handler for the copy button.
- \`invalid\`: Error outline and danger text color.
- \`appearance\`: \`"base"\` (28px) or \`"large"\` (32px).

### States
- **Hover**: neutral overlay on the raised surface.
- **Focus** (\`:focus-within\`): focus border, elevation removed.
- **Invalid**: danger border and text.
- **Disabled**: 50% opacity.
- Uses \`data-component="text-input-v2"\` with \`--v2-background-bg-base\`, \`--v2-elevation-button-neutral\`, \`--v2-text-text-faint\` (placeholder), and \`--v2-icon-icon-muted\` (copy icon).

### Field
Compose with \`Field\` for label, helper prefix/suffix, and tooltip — see the **Field** story.
`

export default {
  title: "UI/TextInput",
  id: "ui-text-input",
  component: TextInput,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "300px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    placeholder: "Placeholder",
    showCopyButton: false,
    disabled: false,
    invalid: false,
    appearance: "base",
  },
  argTypes: {
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

export const WithCopyButton = {
  args: {
    placeholder: "api.example.com/v1",
    defaultValue: "https://api.example.com/v1",
    showCopyButton: true,
    copyLabel: "Copy URL",
  },
}

export const Controlled = {
  render: () => {
    const [value, setValue] = createSignal("Controlled value")
    return (
      <div style={{ display: "grid", gap: "12px" }}>
        <TextInput value={value()} onInput={(e) => setValue(e.currentTarget.value)} placeholder="Type here…" />
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

export const Appearances = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <TextInput appearance="base" placeholder="Base (28px)" defaultValue="Base" />
      <TextInput appearance="large" placeholder="Large (32px)" defaultValue="Large" />
      <TextInput appearance="large" placeholder="Large with copy" defaultValue="copy-me" showCopyButton />
    </div>
  ),
}

export const WithField = {
  parameters: { frameHeight: "500px" },
  render: () => (
    <div style={{ display: "grid", gap: "24px", width: "280px" }}>
      <Field>
        <Field.Label tooltip="Additional context">Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <TextInput placeholder="Text" showCopyButton />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
      <Field invalid>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <TextInput placeholder="Text" defaultValue="Invalid" showCopyButton />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <TextInput placeholder="Default" />
      <TextInput placeholder="With value" defaultValue="Hello world" />
      <TextInput placeholder="With copy" defaultValue="copy-me" showCopyButton />
      <TextInput placeholder="Invalid" defaultValue="Invalid value" invalid showCopyButton />
      <TextInput placeholder="Disabled" disabled />
      <TextInput placeholder="Disabled with value" defaultValue="Read only" disabled showCopyButton />
    </div>
  ),
}
