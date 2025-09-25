import { A } from "@solidjs/router"
import { splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface LinkProps extends ComponentProps<typeof A> {
  variant?: "primary" | "secondary" | "ghost"
  size?: "sm" | "md" | "lg"
}

export function Link(props: LinkProps) {
  const [, others] = splitProps(props, ["variant", "size", "class"])
  return <A {...others} />
}
