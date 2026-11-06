import { createUniqueId, type JSX } from "solid-js"

export function IconButton(props: {
  label: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      class="vz-icon"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export function PlayIcon(props: { playing: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {props.playing ? (
        <path d="M5.5 3.5v9M10.5 3.5v9" />
      ) : (
        <path d="M5.5 3.2 12 8l-6.5 4.8Z" />
      )}
    </svg>
  )
}

export function ResetIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 6.2A5.2 5.2 0 1 1 3.4 10" />
      <path d="M3.2 2.8v3.6h3.6" />
    </svg>
  )
}

export function ViewIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  )
}

export function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3H3v3M10 3h3v3M13 10v3h-3M3 10v3h3" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (value: number) => string
  onInput: (value: number) => void
}) {
  const id = `vz-${createUniqueId()}`

  return (
    <label class="vz-control" for={id}>
      <span>{props.label}</span>
      <input
        id={id}
        class="vz-range"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <output for={id}>{props.format(props.value)}</output>
    </label>
  )
}

export function Segmented<T extends string>(props: {
  label: string
  value: T
  options: ReadonlyArray<{ readonly value: T; readonly label: string; readonly title?: string }>
  onChange: (value: T) => void
}) {
  return (
    <div class="vz-control" role="group" aria-label={props.label}>
      <span>{props.label}</span>
      <div class="vz-segment">
        {props.options.map((option) => (
          <button
            type="button"
            aria-pressed={props.value === option.value}
            title={option.title ?? option.label}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Readout(props: { label: string; value: string; tone?: "accent" | "critical" }) {
  return (
    <span class="vz-readout" data-tone={props.tone}>
      <span>{props.label}</span>
      <b>{props.value}</b>
    </span>
  )
}
