import { AnimatedNumber } from "./animated-number"
import { RollingNumber } from "./rolling-number"

export default {
  title: "UI/AnimatedNumber",
  id: "ui-animated-number",
  args: { value: 9 },
  argTypes: { value: { control: { type: "range", min: 0, max: 120, step: 1 } } },
  render: (args: { value: number }) => <AnimatedNumber class="text-2xl" value={args.value} />,
}

export const SingleDigit = {}

export const Carry = { args: { value: 10 } }

export const ThreeDigits = { args: { value: 100 } }

export const Compare = {
  render: (args: { value: number }) => (
    <dl class="grid grid-cols-2 gap-x-8 gap-y-2 text-center">
      <div>
        <dt>Animated number</dt>
        <dd class="text-2xl">
          <AnimatedNumber value={args.value} />
        </dd>
      </div>
      <div>
        <dt>Rolling number</dt>
        <dd class="text-2xl">
          <RollingNumber value={args.value} />
        </dd>
      </div>
    </dl>
  ),
}
