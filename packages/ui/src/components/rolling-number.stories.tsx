import { RollingNumber } from "./rolling-number"

const defaults = { value: 9, duration: 0.375, bounce: 0 }

export default {
  title: "UI/RollingNumber",
  id: "ui-rolling-number",
  args: defaults,
  argTypes: {
    value: { control: { type: "range", min: 0, max: 120, step: 1 } },
    duration: { control: { type: "range", min: 0.1, max: 1, step: 0.025 } },
    bounce: { control: { type: "range", min: 0, max: 0.5, step: 0.05 } },
  },
  render: (args: typeof defaults) => (
    <RollingNumber class="text-2xl" value={args.value} spring={{ duration: args.duration, bounce: args.bounce }} />
  ),
}

export const SingleDigit = {}

export const Carry = { args: { value: 10 } }

export const CountDown = { args: { value: 8 } }
