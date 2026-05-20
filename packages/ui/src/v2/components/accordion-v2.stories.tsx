// @ts-nocheck
import { AccordionV2 } from "./accordion-v2"

const docs = `### Overview
Compound accordion built on Kobalte's \`Accordion\` primitive. The trigger automatically renders a chevron that rotates open.

### API
- \`AccordionV2\` — root; forwards Kobalte props (\`multiple\`, \`collapsible\`, \`value\`, \`defaultValue\`, \`onChange\`, etc.).
- \`AccordionV2.Item\` — one expandable row; requires a unique \`value: string\`.
- \`AccordionV2.Header\` — wraps the trigger; preserves heading semantics.
- \`AccordionV2.Trigger\` — auto-renders a trailing chevron; pass \`hideChevron\` to opt out.
- \`AccordionV2.Content\` — body shown when the item is expanded; height-animated.

### Behavior
- Single-select by default (\`collapsible\` allows closing the active item). Use \`multiple\` to let several items open at once.
- Open/closed state is reflected on items, triggers, and content via \`data-expanded\` / \`data-closed\`.
- Content height animates using Kobalte's \`--kb-collapsible-content-height\` variable.
`

export default {
  title: "UI V2/Accordion",
  id: "components-accordion-v2",
  component: AccordionV2,
  tags: ["autodocs"],
  parameters: {
    frameBackground: "#f5f5f5",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

const frame = { width: "346px", "font-family": "var(--font-family-sans)", "font-size": "13px" } as const

export const Basic = {
  render: () => (
    <div style={frame}>
      <AccordionV2 collapsible defaultValue={["item-1"]}>
        <AccordionV2.Item value="item-1">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Is it accessible?</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>
            Yes. It follows the WAI-ARIA Accordion pattern and ships with full keyboard support.
          </AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="item-2">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Is it styled?</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Yeah</AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="item-3">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Is it animated?</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Yes. Height animates via Kobalte's collapsible height variable.</AccordionV2.Content>
        </AccordionV2.Item>
      </AccordionV2>
    </div>
  ),
}

export const Multiple = {
  render: () => (
    <div style={frame}>
      <AccordionV2 multiple defaultValue={["a", "c"]}>
        <AccordionV2.Item value="a">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Section A</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Multiple items can be open at once.</AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="b">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Section B</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Open me too.</AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="c">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Section C</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Already open by default.</AccordionV2.Content>
        </AccordionV2.Item>
      </AccordionV2>
    </div>
  ),
}

export const Disabled = {
  render: () => (
    <div style={frame}>
      <AccordionV2 collapsible>
        <AccordionV2.Item value="one">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Enabled item</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Body content.</AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="two" disabled>
          <AccordionV2.Header>
            <AccordionV2.Trigger>Disabled item</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>You can't open this one.</AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="three">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Another enabled item</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Body content.</AccordionV2.Content>
        </AccordionV2.Item>
      </AccordionV2>
    </div>
  ),
}

export const LongContent = {
  render: () => (
    <div style={frame}>
      <AccordionV2 collapsible defaultValue={["long"]}>
        <AccordionV2.Item value="long">
          <AccordionV2.Header>
            <AccordionV2.Trigger>What's inside?</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>
            <div style={{ display: "grid", gap: "8px" }}>
              <p style={{ margin: 0 }}>
                Accordions are useful for compressing dense content into scannable sections. They preserve heading
                semantics and announce open/closed state to screen readers.
              </p>
              <p style={{ margin: 0 }}>
                The body can hold arbitrary content — paragraphs, lists, even nested components.
              </p>
              <ul style={{ margin: 0, "padding-left": "16px" }}>
                <li>Keyboard navigable</li>
                <li>Animated</li>
                <li>Themeable via CSS variables</li>
              </ul>
            </div>
          </AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="short">
          <AccordionV2.Header>
            <AccordionV2.Trigger>One more</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Short body.</AccordionV2.Content>
        </AccordionV2.Item>
      </AccordionV2>
    </div>
  ),
}

export const NoChevron = {
  render: () => (
    <div style={frame}>
      <AccordionV2 collapsible>
        <AccordionV2.Item value="x">
          <AccordionV2.Header>
            <AccordionV2.Trigger hideChevron>Trigger without chevron</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Pass <code>hideChevron</code> on the trigger.</AccordionV2.Content>
        </AccordionV2.Item>
        <AccordionV2.Item value="y">
          <AccordionV2.Header>
            <AccordionV2.Trigger>Default trigger</AccordionV2.Trigger>
          </AccordionV2.Header>
          <AccordionV2.Content>Chevron renders by default.</AccordionV2.Content>
        </AccordionV2.Item>
      </AccordionV2>
    </div>
  ),
}
