import { Button as Kobalte } from "@kobalte/core/button"
import { JSX, Show, splitProps } from "solid-js"

export interface ButtonProps {
  color?: "primary" | "secondary" | "ghost"
  size?: "md" | "sm"
  icon?: JSX.Element
}
export function Button(props: JSX.IntrinsicElements["button"] & ButtonProps) {
  const [split, rest] = splitProps(props, ["color", "size", "icon"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={split.size || "md"}
      data-color={split.color || "primary"}
    >
      <Show when={props.icon}>
        <div data-slot="icon">{props.icon}</div>
      </Show>
      {props.children}
    </Kobalte>
  )
}
