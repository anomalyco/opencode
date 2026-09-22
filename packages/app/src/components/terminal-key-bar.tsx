export type TerminalKeyModifier = "ctrl" | "alt"
export type TerminalKeyModifierState = "off" | "next" | "locked"

const KEY_CLASS =
  "h-7 min-w-8 shrink-0 select-none rounded-md border border-border-weak bg-background-stronger px-2 text-[11px] font-medium text-text-strong"

type KeyButtonProps = {
  id: string
  label: string
  ariaLabel?: string
  pressed?: boolean
  locked?: boolean
  onTap: () => void
}

const KeyButton = (props: KeyButtonProps) => (
  <button
    type="button"
    data-key={props.id}
    aria-label={props.ariaLabel ?? props.label}
    aria-pressed={props.pressed}
    class={KEY_CLASS}
    classList={{
      "border-border-focus bg-background-base text-text-stronger": props.pressed === true,
      "shadow-[inset_0_-2px_0_0_currentColor]": props.locked === true,
    }}
    onPointerDown={(event) => event.preventDefault()}
    onClick={() => props.onTap()}
  >
    {props.label}
  </button>
)

export interface TerminalKeyBarProps {
  ctrl: TerminalKeyModifierState
  alt: TerminalKeyModifierState
  onModifierTap: (modifier: TerminalKeyModifier) => void
  onKey: (data: string) => void
}

export const TerminalKeyBar = (props: TerminalKeyBarProps) => (
  <div
    data-component="terminal-key-bar"
    role="toolbar"
    class="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border-weak bg-background-base px-2 py-1.5"
  >
    <KeyButton id="esc" label="Esc" onTap={() => props.onKey("\x1b")} />
    <KeyButton id="tab" label="Tab" onTap={() => props.onKey("\t")} />
    <KeyButton id="ctrl-c" label="^C" ariaLabel="Ctrl+C" onTap={() => props.onKey("\x03")} />
    <KeyButton
      id="ctrl"
      label="Ctrl"
      pressed={props.ctrl !== "off"}
      locked={props.ctrl === "locked"}
      onTap={() => props.onModifierTap("ctrl")}
    />
    <KeyButton
      id="alt"
      label="Alt"
      pressed={props.alt !== "off"}
      locked={props.alt === "locked"}
      onTap={() => props.onModifierTap("alt")}
    />
    <KeyButton id="left" label="←" onTap={() => props.onKey("\x1b[D")} />
    <KeyButton id="up" label="↑" onTap={() => props.onKey("\x1b[A")} />
    <KeyButton id="down" label="↓" onTap={() => props.onKey("\x1b[B")} />
    <KeyButton id="right" label="→" onTap={() => props.onKey("\x1b[C")} />
  </div>
)
