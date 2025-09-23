import { Button as KobalteButton } from "@kobalte/core/button"
import { splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface ButtonProps extends ComponentProps<typeof KobalteButton> {
  variant?: "primary" | "secondary" | "outline" | "ghost"
  size?: "sm" | "md" | "lg"
}

export const buttonStyles = {
  base: "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  variants: {
    primary: "bg-primary text-background hover:bg-secondary focus-visible:ring-primary data-[disabled]:opacity-50",
    secondary:
      "bg-background-panel text-text hover:bg-background-element focus-visible:ring-secondary data-[disabled]:opacity-50",
    outline:
      "border border-border bg-transparent text-text hover:bg-background-panel focus-visible:ring-border-active data-[disabled]:border-border-subtle data-[disabled]:text-text-muted",
    ghost: "text-text hover:bg-background-panel focus-visible:ring-border-active data-[disabled]:text-text-muted",
  },
  sizes: {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base",
  },
}

export function getButtonClasses(
  variant: keyof typeof buttonStyles.variants = "primary",
  size: keyof typeof buttonStyles.sizes = "md",
  className?: string,
) {
  return `${buttonStyles.base} ${buttonStyles.variants[variant]} ${buttonStyles.sizes[size]}${className ? ` ${className}` : ""}`
}

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, ["variant", "size", "class", "classList"])
  return (
    <KobalteButton
      classList={{
        ...(local.classList ?? {}),
        [buttonStyles.base]: true,
        [buttonStyles.variants[local.variant || "primary"]]: true,
        [buttonStyles.sizes[local.size || "md"]]: true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}
