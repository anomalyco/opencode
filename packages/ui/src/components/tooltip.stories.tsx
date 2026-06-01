// @ts-nocheck
import * as mod from "./tooltip"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Tooltip for contextual hints and keybind callouts.

Use for short hints; avoid long descriptions.

### API
- Required: \`value\` (tooltip content).
- Optional: \`inactive\`, \`forceOpen\`, placement props from Kobalte.

### Variants and states
- Supports keybind-style tooltip via \`TooltipKeybind\`.

### Behavior
- Opens on hover/focus; can be forced open.

### Accessibility
- TODO: confirm trigger semantics and focus behavior.

### Theming/tokens
- Uses \`data-component="tooltip"\` and related slots.

`

const story = create({ title: "UI/Tooltip", mod, args: { value: "Tooltip", children: "Hover me" } })

export default {
  title: "UI/Tooltip",
  id: "components-tooltip",
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

export const Keybind = {
  render: () => (
    <mod.TooltipKeybind title="Search" keybind="Cmd+K">
      <span style={{ "text-decoration": "underline" }}>Hover for keybind</span>
    </mod.TooltipKeybind>
  ),
}

export const ForcedOpen = {
  args: {
    forceOpen: true,
  },
}

export const Inactive = {
  args: {
    inactive: true,
  },
}
