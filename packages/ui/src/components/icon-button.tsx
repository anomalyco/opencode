import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"

export interface IconButtonProps extends ComponentProps<typeof Kobalte> {
  icon: IconProps["name"]
  size?: "small" | "normal" | "large"
  iconSize?: IconProps["size"]
  variant?: "primary" | "secondary" | "ghost"
  ariaLabel?: string
  ariaDescribedby?: string
  ariaExpanded?: boolean
  ariaCurrent?: string
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "iconSize", "class", "classList", "ariaLabel", "ariaDescribedby", "ariaExpanded", "ariaCurrent"])
  return (
    <Kobalte
      {...rest}
      data-component="icon-button"
      data-icon={props.icon}
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      aria-label={split.ariaLabel}
      aria-describedby={split.ariaDescribedby}
      aria-expanded={split.ariaExpanded}
      aria-current={split.ariaCurrent}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Icon name={props.icon} size={split.iconSize ?? (split.size === "large" ? "normal" : "small")} />
    </Kobalte>
  )
}
