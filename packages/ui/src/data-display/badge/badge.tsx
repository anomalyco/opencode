import { type ComponentProps, splitProps } from "solid-js"
import "./badge.css"

export interface BadgeProps extends ComponentProps<"span"> {
  appearance?: "standard" | "compact"
  variant?: "neutral" | "accent"
}

export function Badge(props: BadgeProps) {
  const [split, rest] = splitProps(props, ["class", "classList", "children", "appearance", "variant"])
  return (
    <span
      {...rest}
      data-component="tag"
      data-appearance={split.appearance ?? "compact"}
      data-variant={split.variant ?? "neutral"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </span>
  )
}
