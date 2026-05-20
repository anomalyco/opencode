// @ts-nocheck
import { createSignal } from "solid-js"
import { Field as FieldV2 } from "./field-v2"
import { TextInputV2 } from "./text-input-v2"

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
- Uses \`data-component="text-input-v2"\` with \`--background-bg-base\`, \`--elevation-button-neutral\`, \`--text-text-faint\` (placeholder), and \`--icon-icon-muted\` (copy icon).

### Field
Compose with \`Field\` for label, helper prefix/suffix, and tooltip — see the **Field** story.
`

export default {
  title: "UI V2/TextInput",
  id: "components-text-input-v2",
  component: TextInputV2,
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
        <TextInputV2
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          placeholder="Type here…"
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
      <TextInputV2 appearance="base" placeholder="Base (28px)" defaultValue="Base" />
      <TextInputV2 appearance="large" placeholder="Large (32px)" defaultValue="Large" />
      <TextInputV2 appearance="large" placeholder="Large with copy" defaultValue="copy-me" showCopyButton />
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
        <TextInputV2 placeholder="Text" showCopyButton />
        <FieldV2.Suffix>Suffix</FieldV2.Suffix>
      </FieldV2>
      <FieldV2 invalid>
        <FieldV2.Label>Label</FieldV2.Label>
        <FieldV2.Prefix>Prefix</FieldV2.Prefix>
        <TextInputV2 placeholder="Text" defaultValue="Invalid" showCopyButton />
        <FieldV2.Suffix>Suffix</FieldV2.Suffix>
      </FieldV2>
    </div>
  ),
}

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <TextInputV2 placeholder="Default" />
      <TextInputV2 placeholder="With value" defaultValue="Hello world" />
      <TextInputV2 placeholder="With copy" defaultValue="copy-me" showCopyButton />
      <TextInputV2 placeholder="Invalid" defaultValue="Invalid value" invalid showCopyButton />
      <TextInputV2 placeholder="Disabled" disabled />
      <TextInputV2 placeholder="Disabled with value" defaultValue="Read only" disabled showCopyButton />
    </div>
  ),
}
