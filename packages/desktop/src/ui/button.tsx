import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"

export interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost"
  size?: "sm" | "md" | "lg"
}

export function Button(props: ComponentProps<"button"> & ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-size={split.size || "sm"}
      data-variant={split.variant || "secondary"}
      class="inline-flex items-center justify-center rounded-md cursor-pointer font-medium transition-colors
             min-w-0 whitespace-nowrap truncate
             data-[size=sm]:h-6 data-[size=sm]:pl-2 data-[size=sm]:text-xs
             data-[size=md]:h-8 data-[size=md]:pl-3 data-[size=md]:text-sm
             data-[size=lg]:h-10 data-[size=lg]:pl-4 data-[size=lg]:text-base
             data-[variant=primary]:bg-primary data-[variant=primary]:text-background 
             data-[variant=primary]:hover:bg-secondary data-[variant=primary]:focus-visible:ring-primary
             data-[variant=secondary]:bg-background-element data-[variant=secondary]:text-text
             data-[variant=secondary]:hover:bg-background-element data-[variant=secondary]:focus-visible:ring-secondary
             data-[variant=ghost]:text-text data-[variant=ghost]:hover:bg-background-panel data-[variant=ghost]:focus-visible:ring-border-active
             focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-transparent 
             disabled:pointer-events-none disabled:opacity-50"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.children}
    </Kobalte>
  )
}
