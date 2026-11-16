import { createEffect, createSignal } from "solid-js"
import { Accordion } from "@opencode/ui/accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"

const docs = `### Overview
Sticky accordion header wrapper for persistent section labels.

Use only inside \`Accordion.Item\` with \`Accordion.Trigger\`.

### API
- Accepts standard header props and children.

### Variants and states
- Inherits accordion states.

### Behavior
- Renders inside an Accordion item header.

### Accessibility
- TODO: confirm semantics from Accordion.Header usage.

### Theming/tokens
- Uses \`data-component="sticky-accordion-header"\`.

`

export default {
  title: "UI/StickyAccordionHeader",
  id: "components-sticky-accordion-header",
  component: StickyAccordionHeader,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  args: { expanded: false, disabled: false },
  render: (props: { expanded: boolean; disabled: boolean }) => {
    const [expanded, setExpanded] = createSignal(props.expanded)
    createEffect(() => setExpanded(props.expanded))

    return (
      <Accordion
        collapsible
        value={expanded() ? ["first"] : []}
        onChange={(items: string[]) => setExpanded(items.includes("first"))}
      >
        <Accordion.Item value="first" disabled={props.disabled}>
          <StickyAccordionHeader>
            <Accordion.Trigger>Sticky header</Accordion.Trigger>
          </StickyAccordionHeader>
          <Accordion.Content>
            <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    )
  },
}
