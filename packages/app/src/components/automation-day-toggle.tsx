import type { Component } from "solid-js"

interface DayToggleProps {
  label: string
  active: boolean
  onChange: (value: boolean) => void
}

export const AutomationDayToggle: Component<DayToggleProps> = (props) => {
  const active = () => props.active
  const short = () => {
    return props.label.slice(0, 2)
  }

  const handleClick = () => {
    props.onChange(!active())
  }

  return (
    <button
      type="button"
      aria-pressed={active()}
      aria-label={props.label}
      title={props.label}
      onClick={handleClick}
      class="size-8 rounded-full border text-12-medium flex items-center justify-center transition-colors"
      classList={{
        "bg-surface-base-active border-border-base text-text-strong shadow-xs-border": active(),
        "bg-surface-base border-border-weak-base text-text-weak hover:bg-surface-base-hover hover:border-border-base hover:text-text-base":
          !active(),
      }}
    >
      {short()}
    </button>
  )
}
