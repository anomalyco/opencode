import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"
import { Spinner } from "./spinner"

export interface IconButtonProps extends ComponentProps<typeof Kobalte> {
  icon: IconProps["name"]
  size?: "small" | "normal" | "large"
  iconSize?: IconProps["size"]
  variant?: "primary" | "secondary" | "ghost"
  loading?: boolean
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "iconSize", "class", "classList", "loading"])
  return (
    <Kobalte
      {...rest}
      disabled={rest.disabled || split.loading}
      aria-busy={split.loading || undefined}
      data-component="icon-button"
      data-icon={props.icon}
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show
        when={split.loading}
        fallback={<Icon name={props.icon} size={split.iconSize ?? (split.size === "large" ? "normal" : "small")} />}
      >
        <Spinner />
      </Show>
    </Kobalte>
  )
}
