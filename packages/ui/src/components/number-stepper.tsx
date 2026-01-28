import type { Component } from "solid-js"
import { Icon } from "./icon"

export interface NumberStepperProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  format: (value: number) => string
}

export const NumberStepper: Component<NumberStepperProps> = (props) => {
  const decrement = () => {
    const next = Math.max(props.min, props.value - props.step)
    props.onChange(Math.round(next * 10) / 10)
  }

  const increment = () => {
    const next = Math.min(props.max, props.value + props.step)
    props.onChange(Math.round(next * 10) / 10)
  }

  const handleBlur = (e: FocusEvent) => {
    const target = e.target as HTMLInputElement
    const parsed = parseFloat(target.value)
    if (!isNaN(parsed)) {
      const clamped = Math.min(props.max, Math.max(props.min, parsed))
      props.onChange(Math.round(clamped * 10) / 10)
    }
    target.value = props.format(props.value)
  }

  return (
    <div class="flex items-center border border-border-weak-base rounded-md overflow-hidden">
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 text-icon-weak hover:text-icon-base hover:bg-surface-raised-weak transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={decrement}
        disabled={props.value <= props.min}
      >
        <Icon name="dash" size="small" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        class="w-14 h-8 text-14-mono text-text-base text-center border-x border-border-weak-base bg-transparent outline-none"
        value={props.format(props.value)}
        onBlur={handleBlur}
      />
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 text-icon-weak hover:text-icon-base hover:bg-surface-raised-weak transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={increment}
        disabled={props.value >= props.max}
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}
