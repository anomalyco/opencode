import { ActivityRing } from "./activity-ring"

export default {
  title: "UI/ActivityRing",
  id: "ui-activity-ring",
  args: { size: 14 },
  argTypes: { size: { control: { type: "range", min: 10, max: 32, step: 1 } } },
  render: (args: { size: number }) => (
    <span class="inline-flex items-center gap-2">
      <ActivityRing width={args.size} height={args.size} />
      Session running
    </span>
  ),
}

export const Inline = {}

export const Compact = { args: { size: 12 } }

export const Large = { args: { size: 24 } }
