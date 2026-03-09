// @ts-nocheck
import * as mod from "./text-field"
import { create } from "../storybook/scaffold"

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

const story = create({
  title: "UI/TextField",
  mod,
  args: {
    label: "Label",
    placeholder: "Type here...",
    defaultValue: "Hello",
  },
})

export default {
  title: "UI/TextField",
  id: "components-text-field",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const Variants = {
  render: () => (
    <div style={{ display: "grid", gap: "12px", width: "320px" }}>
      <mod.TextField label="Normal" placeholder="Type here..." defaultValue="Value" />
      <mod.TextField label="Ghost" variant="ghost" placeholder="Type here..." defaultValue="Value" />
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
