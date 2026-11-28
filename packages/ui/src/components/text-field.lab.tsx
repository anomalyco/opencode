import { createEffect, createSignal } from "solid-js"
import { TextField, type TextFieldProps } from "./text-field"

const docs = `### Overview
Text input with label, description, and optional copy-to-clipboard action.

Pair with \`Tooltip\` and \`IconButton\` for copy affordance (built in).

### API
- Supports Kobalte TextField props: \`value\`, \`defaultValue\`, \`onChange\`, \`disabled\`, \`readOnly\`.
- Optional: \`label\`, \`description\`, \`error\`, \`variant\`, \`copyable\`, \`multiline\`.

### Variants and states
- Normal and ghost variants.
- Supports multiline textarea.

### Behavior
- When \`copyable\` is true, clicking copies the current value.

### Accessibility
- Label is hidden when \`hideLabel\` is true (sr-only).

### Theming/tokens
- Uses \`data-component="input"\` with slot attributes for styling.

`

function Sample(props: TextFieldProps) {
  const [value, setValue] = createSignal("")

  createEffect(() => setValue(props.defaultValue ?? ""))

  return <TextField {...props} value={value()} onChange={setValue} />
}

export default {
  title: "UI/TextField",
  id: "components-text-field",
  component: TextField,
  render: Sample,
  args: {
    label: "Label",
    description: "",
    error: "",
    placeholder: "",
    defaultValue: "",
    variant: "normal",
    hideLabel: false,
    multiline: false,
    copyable: false,
    copyKind: "clipboard",
    validationState: "valid",
    required: false,
    disabled: false,
    readOnly: false,
  } satisfies TextFieldProps,
  argTypes: {
    variant: { options: ["normal", "ghost"] },
    copyKind: { options: ["clipboard", "link"] },
    validationState: { options: ["valid", "invalid"] },
  },
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = { args: { placeholder: "Type here...", defaultValue: "Hello" } }

export const Variants = {
  args: { label: "Normal", placeholder: "Type here...", defaultValue: "Value" },
  render: (args: TextFieldProps) => (
    <div style={{ display: "grid", gap: "12px", width: "320px" }}>
      <Sample {...args} />
      <TextField label="Ghost" variant="ghost" placeholder="Type here..." defaultValue="Value" />
    </div>
  ),
}

export const Multiline = {
  args: {
    label: "Description",
    multiline: true,
    defaultValue: "Line one\nLine two",
  },
}

export const Copyable = {
  args: {
    label: "Invite link",
    defaultValue: "https://example.com/invite/abc",
    copyable: true,
    copyKind: "link",
  },
}

export const Error = {
  args: {
    label: "Email",
    defaultValue: "invalid@",
    error: "Enter a valid email address",
    validationState: "invalid",
  },
}

export const Disabled = {
  args: {
    label: "Disabled",
    defaultValue: "Readonly",
    disabled: true,
  },
}

export const ReadOnly = {
  args: {
    label: "Read only",
    defaultValue: "Read only value",
    readOnly: true,
  },
}

export const HiddenLabel = {
  args: {
    label: "Hidden label",
    hideLabel: true,
    placeholder: "Hidden label",
  },
}
