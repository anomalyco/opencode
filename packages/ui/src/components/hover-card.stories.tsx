import { createEffect, createSignal } from "solid-js"
import { HoverCard, type HoverCardProps } from "./hover-card"

const docs = `### Overview
Hover-triggered card for lightweight previews and metadata.

Use for short summaries; avoid dense interactive controls.

### API
- Required: \`trigger\` element.
- Children render inside the hover card body.

### Variants and states
- None; content and trigger are fully composable.

### Behavior
- Opens on hover/focus over the trigger.

### Accessibility
- TODO: confirm focus and hover intent behavior from Kobalte.

### Theming/tokens
- Uses \`data-component="hover-card-content"\` and slots for styling.

`

export default {
  title: "UI/HoverCard",
  id: "components-hover-card",
  component: HoverCard,
  args: { open: false, placement: "bottom" },
  argTypes: { placement: { control: "select", options: ["top", "right", "bottom", "left"] } },
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

type CardArgs = Pick<HoverCardProps, "open" | "placement" | "mount"> & { inline?: boolean }

function Card(props: CardArgs) {
  const [open, setOpen] = createSignal(props.open)
  createEffect(() => setOpen(props.open))

  return (
    <HoverCard
      open={open()}
      onOpenChange={setOpen}
      placement={props.placement}
      mount={props.mount}
      trigger={<span style={{ "text-decoration": "underline", cursor: "default" }}>Hover me</span>}
    >
      <div style={{ display: "grid", gap: "6px" }}>
        <div style={{ "font-weight": 600 }}>{props.inline ? "Mounted inside" : "Preview"}</div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>
          {props.inline ? "Uses custom mount node." : "Short supporting text."}
        </div>
      </div>
    </HoverCard>
  )
}

export const Basic = { render: Card }

export const InlineMount = {
  render: (props: CardArgs) => {
    const [mount, setMount] = createSignal<HTMLDivElement | undefined>(undefined)

    return (
      <div ref={setMount} style={{ padding: "16px", border: "1px dashed var(--border-weak)" }}>
        <Card {...props} inline mount={mount()} />
      </div>
    )
  },
}
