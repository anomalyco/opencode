import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"

export interface ButtonProps {
  size?: "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
}

export function Button(props: ComponentProps<"button"> & ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.children}
    </Kobalte>
  )
}
