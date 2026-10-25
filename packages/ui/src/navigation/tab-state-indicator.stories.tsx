import { TabStateIndicator } from "./tab-state-indicator"

export default {
  title: "UI/TabStateIndicator",
  id: "ui-tab-state-indicator",
  component: TabStateIndicator,
  tags: ["autodocs"],
}

export const Basic = {}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
      <TabStateIndicator width={12} height={12} />
      <TabStateIndicator />
      <TabStateIndicator width={24} height={24} />
    </div>
  ),
}
