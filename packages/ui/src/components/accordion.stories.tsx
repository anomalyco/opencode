// @ts-nocheck
import { createEffect, createSignal } from "solid-js"
import * as mod from "./accordion"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Accordion", mod })
export default { title: "UI/Accordion", id: "components-accordion", component: story.meta.component }
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
