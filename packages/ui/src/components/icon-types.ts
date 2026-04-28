import type { ComponentProps } from "solid-js"

export interface IconProps extends ComponentProps<"svg"> {
  name: string
  size?: "small" | "normal" | "medium" | "large"
}
