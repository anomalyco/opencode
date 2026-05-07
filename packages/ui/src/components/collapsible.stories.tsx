// @ts-nocheck
import * as mod from "./collapsible"

const docs = `### Overview
Toggleable content region with optional arrow indicator.

Compose \`Collapsible.Trigger\`, \`Collapsible.Content\`, and \`Collapsible.Arrow\`.

### API
- Root accepts Kobalte Collapsible props (\`open\`, \`defaultOpen\`, \`onOpenChange\`).
- \`variant\` controls styling ("normal" | "ghost").

### Variants and states
- Normal and ghost variants.
- Open/closed states.

### Behavior
- Trigger toggles the content visibility.

### Accessibility
- TODO: confirm ARIA attributes provided by Kobalte.

### Theming/tokens
- Uses \`data-component="collapsible"\` and slots for trigger/content/arrow.

`

export default {
  title: "UI/Collapsible",
  id: "components-collapsible",
  component: mod.Collapsible,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["normal", "ghost"],
    },
  },
}

export const Basic = {
  args: {
    variant: "normal",
    defaultOpen: true,
  },
  render: (props) => (
    <mod.Collapsible {...props}>
      <mod.Collapsible.Trigger data-slot="collapsible-trigger">
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span>Details</span>
          <mod.Collapsible.Arrow />
        </div>
      </mod.Collapsible.Trigger>
      <mod.Collapsible.Content data-slot="collapsible-content">
        <div style={{ color: "var(--text-weak)", "padding-top": "8px" }}>Optional details sit here.</div>
      </mod.Collapsible.Content>
    </mod.Collapsible>
  ),
}

export const Ghost = {
  args: {
    variant: "ghost",
    defaultOpen: false,
  },
  render: (props) => (
    <mod.Collapsible {...props}>
      <mod.Collapsible.Trigger data-slot="collapsible-trigger">
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span>Ghost trigger</span>
          <mod.Collapsible.Arrow />
        </div>
      </mod.Collapsible.Trigger>
      <mod.Collapsible.Content data-slot="collapsible-content">
        <div style={{ color: "var(--text-weak)", "padding-top": "8px" }}>Ghost content.</div>
      </mod.Collapsible.Content>
    </mod.Collapsible>
  ),
}
