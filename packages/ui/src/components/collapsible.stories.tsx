import { createEffect, createSignal } from "solid-js"
import { Collapsible, type CollapsibleProps } from "./collapsible"

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
  component: Collapsible,
  args: { disabled: false },
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

function Details(props: CollapsibleProps & { label: string; content: string }) {
  const [open, setOpen] = createSignal(props.defaultOpen)
  createEffect(() => setOpen(props.defaultOpen))

  return (
    <Collapsible variant={props.variant} disabled={props.disabled} open={open()} onOpenChange={setOpen}>
      <Collapsible.Trigger>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span>{props.label}</span>
          <Collapsible.Arrow />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div style={{ color: "var(--text-weak)", "padding-top": "8px" }}>{props.content}</div>
      </Collapsible.Content>
    </Collapsible>
  )
}

export const Basic = {
  args: { variant: "normal", defaultOpen: true },
  render: (props: CollapsibleProps) => <Details {...props} label="Details" content="Optional details sit here." />,
}

export const Ghost = {
  args: { variant: "ghost", defaultOpen: false },
  render: (props: CollapsibleProps) => <Details {...props} label="Ghost trigger" content="Ghost content." />,
}
