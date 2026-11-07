import type { JSX } from "solid-js"

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
