// @ts-nocheck
import * as mod from "./accordion"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Accordion", mod })
export default { title: "UI/Accordion", id: "components-accordion", component: story.meta.component }
export const Basic = {
  render: () => {
    return (
      <div style={{ display: "grid", gap: "8px", width: "420px" }}>
        <mod.Accordion collapsible defaultValue={["first"]}>
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
