// @ts-nocheck
import { Accordion } from "./accordion"
import * as mod from "./sticky-accordion-header"

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
  component: mod.StickyAccordionHeader,
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
  render: () => (
    <Accordion value="first">
      <Accordion.Item value="first">
        <mod.StickyAccordionHeader>
          <Accordion.Trigger>Sticky header</Accordion.Trigger>
        </mod.StickyAccordionHeader>
        <Accordion.Content>
          <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  ),
}
