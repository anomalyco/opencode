import { Button as KobalteButton } from "@kobalte/core/button"
import { splitProps } from "solid-js"
import type { ComponentProps, JSX } from "solid-js"

export interface IconButtonProps extends ComponentProps<typeof KobalteButton> {
  variant?: "primary" | "secondary" | "outline" | "ghost"
  size?: "xs" | "sm" | "md" | "lg"
  children: JSX.Element
}

export function IconButton(props: IconButtonProps) {
  const [local, others] = splitProps(props, ["variant", "size", "class", "classList"])
  return (
    <KobalteButton
      classList={{
        ...(local.classList || {}),
        "inline-flex items-center justify-center rounded-md font-medium cursor-pointer": true,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2": true,
        "disabled:pointer-events-none disabled:opacity-50": true,
        "bg-primary text-background hover:bg-secondary focus-visible:ring-primary data-[disabled]:opacity-50":
          (local.variant || "primary") === "primary",
        "bg-background-panel text-text hover:bg-background-element focus-visible:ring-secondary data-[disabled]:opacity-50":
          local.variant === "secondary",
        "border border-border bg-transparent text-text hover:bg-background-panel": local.variant === "outline",
        "focus-visible:ring-border-active data-[disabled]:border-border-subtle data-[disabled]:text-text-muted":
          local.variant === "outline",
        "text-text hover:bg-background-panel focus-visible:ring-border-active data-[disabled]:text-text-muted":
          local.variant === "ghost",
        "h-5 w-5 text-xs": local.size === "xs",
        "h-8 w-8 text-sm": local.size === "sm",
        "h-10 w-10 text-sm": (local.size || "md") === "md",
        "h-12 w-12 text-base": local.size === "lg",
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}
