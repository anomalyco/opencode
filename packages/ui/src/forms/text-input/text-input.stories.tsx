import { createEffect, createSignal, splitProps } from "solid-js"
import { Field } from "@opencode/ui/field"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { TextInput, type TextInputProps } from "./text-input"

const docs = `### Overview
Compact single-line text field with neutral elevation, optional trailing copy action, and theme tokens.

### API
- Forwards native \`input\` props (\`value\`, \`defaultValue\`, \`placeholder\`, \`disabled\`, \`name\`, \`type\`, etc.).
- \`showCopyButton\`: Renders the trailing outline-copy control.
- \`copyLabel\`: Accessible name for the copy button (default: "Copy").
- \`onCopyClick\`: Handler for the copy button.
- \`invalid\`: Error outline and danger text color.
- \`appearance\`: \`"small"\` (24px), \`"base"\` (28px), or \`"large"\` (32px).
- \`surface\`: \`"base"\` (default) or \`"layer-1"\` for a flat fill; \`"invisible"\` is unfilled at rest, with hover fill and inset focus/error outlines.

### States
- **Hover**: neutral overlay on the raised surface.
- **Focus** (\`:focus-within\`): focus border, elevation removed.
- **Invalid**: danger border and text.
- **Disabled**: 50% opacity.
- Uses \`data-component="text-input-v2"\` with \`--v2-background-bg-base\`, \`--v2-elevation-input\`, \`--v2-text-text-faint\` (placeholder), and \`--v2-icon-icon-muted\` (copy icon).

### Field
Compose with \`Field\` for label, helper prefix/suffix, and tooltip — see the **Field** story.
`

type Controls = TextInputProps & {
  defaultValue?: string
  showLeadingIcon?: boolean
  showTrailing?: boolean
  onValue?: (value: string) => void
}

function Sample(props: Controls) {
  const [local, input] = splitProps(props, ["defaultValue", "showLeadingIcon", "showTrailing", "onValue"])

  const [value, setValue] = createSignal("")

  createEffect(() => setValue(local.defaultValue ?? ""))
  createEffect(() => local.onValue?.(value()))

  let field!: HTMLInputElement

  return (
    <TextInput
      {...input}
      ref={field}
      copyLabel={props.copyLabel || undefined}
      value={value()}
      onInput={(event) => setValue(event.currentTarget.value)}
      leadingIcon={local.showLeadingIcon && <Icon name="magnifying-glass" />}
      trailing={local.showTrailing && <Keybind keys={["↵"]} variant="neutral" />}
      onClearClick={() => setValue("")}
      onCopyClick={() => {
        const copySelection = () => {
          field.select()
          document.execCommand("copy")
        }

        if (!navigator.clipboard) return copySelection()
        void navigator.clipboard.writeText(value()).catch(copySelection)
      }}
    />
  )
}

export default {
  title: "UI/TextInput",
  id: "ui-text-input",
  component: TextInput,
  render: Sample,
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
    defaultValue: "",
    showCopyButton: false,
    copyLabel: "",
    showClearButton: false,
    showLeadingIcon: false,
    showTrailing: false,
    numeric: false,
    readOnly: false,
    disabled: false,
    invalid: false,
    appearance: "base",
    surface: "base",
    type: "text",
  } satisfies Controls,
  argTypes: {
    type: { options: ["text", "search", "email", "password", "url", "tel", "number"] },
    surface: {
      control: "select",
      options: ["base", "layer-1", "invisible"],
    },
    appearance: {
      control: "select",
      options: ["small", "base", "large"],
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

export const Surfaces = {
  args: { placeholder: "Base (default)" },
  render: (args: Controls) => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Sample {...args} />
      <TextInput surface="layer-1" placeholder="Layer 1" />
      <TextInput surface="invisible" placeholder="Invisible" />
      <TextInput surface="invisible" placeholder="Invisible, invalid" invalid />
      <TextInput surface="invisible" placeholder="Invisible, disabled" disabled />
    </div>
  ),
}

export const WithCopyButton = {
  args: {
    placeholder: "api.example.com/v1",
    defaultValue: "https://api.example.com/v1",
    showCopyButton: true,
    copyLabel: "Copy URL",
  },
}

export const Controlled = {
  args: { defaultValue: "Controlled value", placeholder: "Type here…" },
  render: (args: Controls) => {
    const [value, setValue] = createSignal("Controlled value")

    return (
      <div style={{ display: "grid", gap: "12px" }}>
        <Sample {...args} onValue={setValue} />
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
  args: { appearance: "small", placeholder: "Small (24px)" },
  render: (args: Controls) => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Sample {...args} />
      <TextInput appearance="base" placeholder="Base (28px)" value="Base" />
      <TextInput appearance="large" placeholder="Large (32px)" value="Large" />
      <Sample appearance="large" placeholder="Large with copy" defaultValue="copy-me" showCopyButton />
      <Sample appearance="small" placeholder="Small with clear" showClearButton />
      <Sample appearance="base" placeholder="Base with clear" showClearButton />
      <Sample appearance="large" placeholder="Large with clear" showClearButton />
    </div>
  ),
}

export const WithField = {
  parameters: { frameHeight: "500px" },
  args: { placeholder: "Text", showCopyButton: true },
  render: (args: Controls) => (
    <div style={{ display: "grid", gap: "24px", width: "280px" }}>
      <Field invalid={args.invalid}>
        <Field.Label tooltip="Additional context">Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Sample {...args} />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
      <Field invalid>
        <Field.Label>Label</Field.Label>
        <Field.Prefix>Prefix</Field.Prefix>
        <Sample placeholder="Text" defaultValue="Invalid" showCopyButton />
        <Field.Suffix>Suffix</Field.Suffix>
      </Field>
    </div>
  ),
}

export const States = {
  args: { placeholder: "Default" },
  render: (args: Controls) => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Sample {...args} />
      <TextInput placeholder="With value" value="Hello world" />
      <Sample placeholder="With copy" defaultValue="copy-me" showCopyButton />
      <Sample placeholder="Invalid" defaultValue="Invalid value" invalid showCopyButton />
      <TextInput placeholder="Disabled" disabled />
      <TextInput placeholder="Disabled with value" value="Read only" disabled showCopyButton />
    </div>
  ),
}
