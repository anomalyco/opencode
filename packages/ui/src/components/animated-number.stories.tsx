// @ts-nocheck
import { createSignal } from "solid-js"
import { AnimatedNumber } from "./animated-number"

const docs = `### Overview
Odometer-style number that animates each digit to its next value.

### Behavior
- Digits are laid out in reverse DOM order and the value is rendered backwards, so the visual reading order needs \`flex-direction: row-reverse\`.
- Every digit renders a 30-cell strip that is only visible while that digit animates.

### Accessibility
- The visible digits and the strip are decorative and carry \`aria-hidden="true"\`.
- The current value is exposed once as visually hidden text (the \`.sr-only\` utility), so assistive technology reads
  \`12\` instead of \`2 1\`, and never the animation cells.

### Theming/tokens
- \`--animated-number-width\` sizes the value; \`--tool-motion-odometer-ms\` (600ms default) is the animation duration.
`

const frame = {
  display: "grid",
  gap: "12px",
  "justify-items": "start",
  padding: "20px",
  "font-size": "14px",
  color: "var(--color-text, #eee)",
} as const

export default {
  title: "UI/AnimatedNumber",
  id: "ui-animated-number",
  component: AnimatedNumber,
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
  render: () => (
    <div style={frame}>
      <AnimatedNumber value={12} />
    </div>
  ),
}

export const SingleDigit = {
  render: () => (
    <div style={frame}>
      <AnimatedNumber value={7} />
    </div>
  ),
}

export const Updating = {
  render: () => {
    const [value, setValue] = createSignal(5)

    return (
      <div style={{ ...frame, "--tool-motion-odometer-ms": "2000ms" }}>
        <AnimatedNumber value={value()} />
        <button onClick={() => setValue((current) => current + 1)}>Increment</button>
        <button onClick={() => setValue((current) => current - 1)}>Decrement</button>
        <button onClick={() => setValue((current) => current + 8)}>Skip eight</button>
        <button onClick={() => setValue(123)}>Reach 123</button>
      </div>
    )
  },
}
