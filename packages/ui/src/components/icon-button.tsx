import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, children, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"

export interface IconButtonProps extends ComponentProps<typeof Kobalte> {
  icon: IconProps["name"]
  size?: "normal" | "large"
  iconSize?: IconProps["size"]
  variant?: "primary" | "secondary" | "ghost"
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "iconSize", "class", "classList", "children"])
  const content = children(() => split.children)
  return (
    <Kobalte
      {...rest}
      data-component="icon-button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {content() ?? <Icon name={props.icon} size={split.iconSize ?? (split.size === "large" ? "normal" : "small")} />}
    </Kobalte>
  )
}
