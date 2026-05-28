// @ts-nocheck
import { createEffect, createSignal } from "solid-js"
import * as mod from "./accordion"
import { create } from "../storybook/scaffold"

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
- TODO: confirm keyboard navigation from Kobalte Accordion.

### Theming/tokens
- Uses \`data-component="accordion"\` and slot data attributes.

`

const story = create({ title: "UI/Accordion", mod })
export default {
  title: "UI/Accordion",
  id: "components-accordion",
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
export const Basic = {
  args: {
    collapsible: true,
    multiple: false,
    value: "first",
  },
  argTypes: {
    collapsible: { control: "boolean" },
    multiple: { control: "boolean" },
    value: {
      control: "select",
      options: ["first", "second", "none"],
      mapping: {
        none: undefined,
      },
    },
  },
  render: (props) => {
    const [value, setValue] = createSignal(props.value)
    createEffect(() => {
      setValue(props.value)
    })

    const current = () => {
      if (props.multiple) {
        if (Array.isArray(value())) return value()
        if (value()) return [value()]
        return []
      }

      if (Array.isArray(value())) return value()[0]
      return value()
    }

    return (
      <div style={{ display: "grid", gap: "8px", width: "420px" }}>
        <mod.Accordion collapsible={props.collapsible} multiple={props.multiple} value={current()} onChange={setValue}>
          <mod.Accordion.Item value="first">
            <mod.Accordion.Header>
              <mod.Accordion.Trigger>First</mod.Accordion.Trigger>
            </mod.Accordion.Header>
            <mod.Accordion.Content>
              <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
            </mod.Accordion.Content>
          </mod.Accordion.Item>
          <mod.Accordion.Item value="second">
            <mod.Accordion.Header>
              <mod.Accordion.Trigger>Second</mod.Accordion.Trigger>
            </mod.Accordion.Header>
            <mod.Accordion.Content>
              <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>More content.</div>
            </mod.Accordion.Content>
          </mod.Accordion.Item>
        </mod.Accordion>
      </div>
    )
  },
}

export const Multiple = {
  args: {
    collapsible: true,
    multiple: true,
    value: ["first", "second"],
  },
  render: (props) => (
    <mod.Accordion collapsible={props.collapsible} multiple={props.multiple} value={props.value}>
      <mod.Accordion.Item value="first">
        <mod.Accordion.Header>
          <mod.Accordion.Trigger>First</mod.Accordion.Trigger>
        </mod.Accordion.Header>
        <mod.Accordion.Content>
          <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
        </mod.Accordion.Content>
      </mod.Accordion.Item>
      <mod.Accordion.Item value="second">
        <mod.Accordion.Header>
          <mod.Accordion.Trigger>Second</mod.Accordion.Trigger>
        </mod.Accordion.Header>
        <mod.Accordion.Content>
          <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>More content.</div>
        </mod.Accordion.Content>
      </mod.Accordion.Item>
    </mod.Accordion>
  ),
}

export const NonCollapsible = {
  args: {
    collapsible: false,
    multiple: false,
    value: "first",
  },
  render: (props) => (
    <mod.Accordion collapsible={props.collapsible} multiple={props.multiple} value={props.value}>
      <mod.Accordion.Item value="first">
        <mod.Accordion.Header>
          <mod.Accordion.Trigger>First</mod.Accordion.Trigger>
        </mod.Accordion.Header>
        <mod.Accordion.Content>
          <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
        </mod.Accordion.Content>
      </mod.Accordion.Item>
    </mod.Accordion>
  ),
}
