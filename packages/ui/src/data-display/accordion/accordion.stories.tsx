import { createEffect, createSignal, Show } from "solid-js"
import { Accordion } from "./accordion"

const defaults = {
  value: "first",
  multiple: false,
  collapsible: true,
  secondItem: true,
  disableSecond: false,
  shouldFocusWrap: true,
}

const docs = `### Overview
Accordion for collapsible content sections with optional multi-open behavior. Use one trigger per item.

### API and behavior
Compose Accordion.Item, Header, Trigger and Content. The root supports Kobalte's multiple and collapsible modes.
Control expanded items with a string array and onChange; in this preview the value control sets the starting selection.

### Accessibility and theming
Kobalte supplies keyboard navigation and ARIA behavior. Use data-component="accordion" and its slot attributes for theming.`

export default {
  title: "UI/Accordion",
  id: "ui-accordion",
  component: Accordion,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
  args: defaults,
  argTypes: { value: { control: "select", options: ["none", "first", "second", "both"] } },
  render: (args: typeof defaults) => {
    const [value, setValue] = createSignal<string[]>([])

    createEffect(() => {
      if (args.value === "both") return setValue(args.multiple ? ["first", "second"] : ["first"])
      setValue(args.value === "none" ? [] : [args.value])
    })

    return (
      <div style={{ width: "min(420px, 100%)" }}>
        <Accordion
          collapsible={args.collapsible}
          multiple={args.multiple}
          shouldFocusWrap={args.shouldFocusWrap}
          value={args.multiple ? value() : value().slice(0, 1)}
          onChange={setValue}
        >
          <Accordion.Item value="first">
            <Accordion.Header>
              <Accordion.Trigger>First</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
            </Accordion.Content>
          </Accordion.Item>
          <Show when={args.secondItem}>
            <Accordion.Item value="second" disabled={args.disableSecond}>
              <Accordion.Header>
                <Accordion.Trigger>Second</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>More content.</div>
              </Accordion.Content>
            </Accordion.Item>
          </Show>
        </Accordion>
      </div>
    )
  },
}

export const Basic = {}

export const Multiple = { args: { multiple: true, collapsible: false, value: "both" } }

export const NonCollapsible = { args: { collapsible: false, secondItem: false } }
