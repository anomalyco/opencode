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

const round = (value: number) => Math.round(value * 10) / 10

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const NumberStepper: Component<NumberStepperProps> = (props) => {
  const change = (value: number) => props.onChange(round(clamp(value, props.min, props.max)))

  const handleBlur = (event: FocusEvent) => {
    const target = event.currentTarget as HTMLInputElement
    const parsed = Number.parseFloat(target.value)
    if (Number.isFinite(parsed)) change(parsed)
    target.value = props.format(props.value)
  }

  return (
    <div class="flex h-8 items-center overflow-hidden rounded-md border border-border-weak-base">
      <button
        type="button"
        class="flex size-8 items-center justify-center text-icon-weak transition-colors hover:bg-surface-raised-weak hover:text-icon-base disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => change(props.value - props.step)}
        disabled={props.value <= props.min}
      >
        <Icon name="dash" size="small" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        class="h-8 w-14 border-x border-border-weak-base bg-transparent text-center text-14-mono text-text-base outline-none"
        value={props.format(props.value)}
        onBlur={handleBlur}
      />
      <button
        type="button"
        class="flex size-8 items-center justify-center text-icon-weak transition-colors hover:bg-surface-raised-weak hover:text-icon-base disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => change(props.value + props.step)}
        disabled={props.value >= props.max}
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}
