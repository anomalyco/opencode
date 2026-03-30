import type { ComponentProps, ParentProps } from "solid-js"

export interface KeybindProps extends ParentProps {
  class?: string
  classList?: ComponentProps<"span">["classList"]
}

export function Keybind(props: KeybindProps) {
  return (
    <span
      data-component="keybind"
      classList={{
        ...(props.classList ?? {}),
        [props.class ?? ""]: !!props.class,
      }}
    >
      {props.children}
    </span>
  )
}
