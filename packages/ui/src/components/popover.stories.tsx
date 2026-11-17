import { createEffect, createSignal } from "solid-js"
import { Popover, type PopoverProps } from "./popover"

const docs = `### Overview
Composable popover with optional title, description, and close button.

Use for small contextual details; avoid long forms.

### API
- \`trigger\` and \`children\` define the anchor and content.
- Optional: \`title\`, \`description\`, \`portal\`, \`open\`, \`defaultOpen\`.

### Variants and states
- Supports controlled and uncontrolled open state.

### Behavior
- Closes on outside click or Escape by default.

### Accessibility
- TODO: confirm focus management from Kobalte.

### Theming/tokens
- Uses \`data-component="popover-content"\` and related slots.

`

export default {
  title: "UI/Popover",
  id: "components-popover",
  component: Popover,
  args: {
    trigger: "Open popover",
    title: "Popover",
    description: "Optional description",
    defaultOpen: true,
    portal: true,
    children: "Popover content",
  },
  render: (props: PopoverProps) => {
    const [open, setOpen] = createSignal(props.defaultOpen)
    createEffect(() => setOpen(props.defaultOpen))

    return <Popover {...props} open={open()} onOpenChange={setOpen} />
  },
  tags: ["autodocs"],
  parameters: {
    gridPreview: () => (
      <Popover trigger="Open popover" title="Popover" portal={false} defaultOpen>
        Popover content
      </Popover>
    ),
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {}

export const NoHeader = {
  args: {
    title: "",
    description: "",
    children: "Popover body only",
  },
}

export const Inline = {
  args: {
    portal: false,
    defaultOpen: true,
  },
}

export const Controlled = {
  args: {
    trigger: "Toggle popover",
    title: "Controlled",
    description: "Open state is controlled",
    children: "Controlled content",
  },
}
