import { type ComponentProps, splitProps } from "solid-js"

export interface CardProps extends ComponentProps<"div"> {
  variant?: "normal" | "error" | "warning" | "success" | "info"
}

export function Card(props: CardProps) {
  const [split, rest] = splitProps(props, ["variant", "class", "classList"])
  return (
    <div
      {...rest}
      data-component="card"
      data-variant={split.variant || "normal"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.children}
    </div>
  )
}
