import { For } from "solid-js"
import { ProgressCircle } from "./progress-circle"

export default {
  title: "UI/ProgressCircle",
  id: "ui-progress-circle",
  component: ProgressCircle,
  tags: ["autodocs"],
  args: {
    percentage: 60,
  },
  argTypes: {
    percentage: { control: { type: "range", min: 0, max: 100, step: 1 } },
    appearance: { control: "select", options: ["compact", "indicator"] },
  },
}

export const Playground = {}

export const Progress = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <For each={[0, 25, 50, 75, 100]}>{(percentage) => <ProgressCircle percentage={percentage} />}</For>
    </div>
  ),
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <ProgressCircle percentage={60} size={12} />
      <ProgressCircle percentage={60} />
      <ProgressCircle percentage={60} size={20} strokeWidth={2} />
    </div>
  ),
}

export const Indicator = {
  render: () => (
    <ProgressCircle
      appearance="indicator"
      percentage={60}
      size={16}
      strokeWidth={2}
      style={{
        "--progress-circle-background": "var(--v2-background-bg-layer-04, var(--border-weak-base))",
        "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
        "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
      }}
    />
  ),
}
