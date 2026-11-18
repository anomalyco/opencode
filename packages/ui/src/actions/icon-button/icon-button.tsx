import type { Root } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"
import { JSX } from "solid-js"
import "./icon-button.css"

export interface IconButtonProps
  extends ComponentProps<typeof Root>,
    Pick<ComponentProps<"button">, "class" | "classList"> {
  icon?: JSX.Element
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "contrast" | "submit" | "ghost" | "ghost-muted"
  state?: "rest" | "hover" | "pressed"
}

// A native button with the attributes Kobalte's Button sets on one, without its per-instance computations.
export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "icon",
    "class",
    "classList",
    "state",
    "type",
    "disabled",
  ])

  return (
    <button
      type={local.type ?? "button"}
      disabled={local.disabled}
      data-disabled={local.disabled ? "" : undefined}
      {...rest}
      data-component="icon-button-v2"
      data-size={local.size || "normal"}
      data-variant={local.variant || "neutral"}
      data-state={local.state}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.icon}
    </button>
  )
}
