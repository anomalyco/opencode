// @ts-nocheck
import { Button } from "./button"

const docs = `### Overview
Primary action button with size, variant, and optional icon support.

Use \`IconButton\` for icon-only actions.

### API
- \`variant\`: "primary" | "secondary" | "ghost".
- \`size\`: "small" | "normal" | "large".
- \`icon\`: Icon name for a leading icon.
- Inherits Kobalte Button props and native button attributes.

### Variants and states
- Variants: primary, secondary, ghost.
- States: disabled.

### Behavior
- Renders an Icon when \`icon\` is set.

### Accessibility
- Provide clear label text; use \`aria-label\` for icon-only buttons.

### Theming/tokens
- Uses \`data-component="button"\` with size/variant data attributes.

`

export default {
  title: "UI/Button",
  id: "components-button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    children: "Button",
    variant: "secondary",
    size: "normal",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost"],
    },
    size: {
      control: "select",
      options: ["small", "normal", "large"],
    },
    icon: {
      control: "select",
      options: ["none", "check", "plus", "arrow-right"],
      mapping: {
        none: undefined,
      },
    },
  },
}

export const Primary = {
  args: {
    variant: "primary",
  },
}

export const Secondary = {}

export const Ghost = {
  args: {
    variant: "ghost",
  },
}

export const WithIcon = {
  args: {
    children: "Continue",
    icon: "arrow-right",
  },
}

export const Disabled = {
  args: {
    variant: "primary",
    disabled: true,
  },
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
      <Button size="small" variant="secondary">
        Small
      </Button>
      <Button size="normal" variant="secondary">
        Normal
      </Button>
      <Button size="large" variant="secondary">
        Large
      </Button>
    </div>
  ),
}
