// @ts-nocheck
import { createEffect, createSignal } from "solid-js"
import { Accordion } from "./accordion"

const docs = `### Overview
Accordion for collapsible content sections with optional multi-open behavior.

Use one trigger per item; keep content concise.

### API
- Root supports Kobalte Accordion props: \`value\`, \`multiple\`, \`collapsible\`, \`onChange\`.
- Compose with \`Accordion.Item\`, \`Header\`, \`Trigger\`, \`Content\`.

### Variants and states
- Single or multiple open items.
- Collapsible or fixed-open behavior.

### Behavior
- Controlled via \`value\`/\`onChange\` when provided.

### Accessibility
- Uses Kobalte Accordion keyboard and ARIA behavior.

### Theming/tokens
- Uses \`data-component="accordion"\` and slot data attributes.
`

export default {
  title: "UI/Accordion",
  id: "ui-accordion",
  component: Accordion,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const Basic = {
  args: { collapsible: true, multiple: false, value: "first" },
  argTypes: {
    collapsible: { control: "boolean" },
    multiple: { control: "boolean" },
    value: { control: "select", options: ["first", "second", "none"], mapping: { none: undefined } },
  },
  render: (props) => {
    const [value, setValue] = createSignal(props.value)
    createEffect(() => setValue(props.value))
    const current = () => {
      if (props.multiple) return Array.isArray(value()) ? value() : value() ? [value()] : []
      return Array.isArray(value()) ? value()[0] : value()
    }
    return (
      <div style={{ display: "grid", gap: "8px", width: "420px" }}>
        <Accordion collapsible={props.collapsible} multiple={props.multiple} value={current()} onChange={setValue}>
          <Accordion.Item value="first">
            <Accordion.Header>
              <Accordion.Trigger>First</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="second">
            <Accordion.Header>
              <Accordion.Trigger>Second</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>More content.</div>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion>
      </div>
    )
  },
}

export const Multiple = {
  render: () => (
    <Accordion multiple value={["first", "second"]}>
      <Accordion.Item value="first">
        <Accordion.Header>
          <Accordion.Trigger>First</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>Accordion content.</Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="second">
        <Accordion.Header>
          <Accordion.Trigger>Second</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>More content.</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  ),
}

export const NonCollapsible = {
  render: () => (
    <Accordion value="first">
      <Accordion.Item value="first">
        <Accordion.Header>
          <Accordion.Trigger>First</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>Accordion content.</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  ),
}
