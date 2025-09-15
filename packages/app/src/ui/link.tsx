import { A } from "@solidjs/router"
import { splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"
import { getButtonClasses } from "./button"

export interface LinkProps extends ComponentProps<typeof A> {
  variant?: "primary" | "secondary" | "outline" | "ghost"
  size?: "sm" | "md" | "lg"
}

export function Link(props: LinkProps) {
  const [local, others] = splitProps(props, ["variant", "size", "class"])
  const classes = local.variant ? getButtonClasses(local.variant, local.size, local.class) : local.class
  return <A class={classes} {...others} />
}
