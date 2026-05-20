import { type ComponentProps, splitProps } from "solid-js"

export interface IconProps extends ComponentProps<"svg"> {
  name: string
  size?: "small" | "normal" | "large"
}

/**
 * Placeholder icon component
 */
export function Icon(props: IconProps) {
  const [split, rest] = splitProps(props, ["name", "size"])
  const pixelSize = split.size === "small" ? 14 : split.size === "large" ? 20 : 16
  return (
    <svg
      {...rest}
      data-slot="icon-svg"
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <path d="M8 2.88867V13.1109" stroke="currentColor" stroke-linejoin="round" />
      <path d="M2.88867 8H13.1109" stroke="currentColor" stroke-linejoin="round" />
    </svg>
  )
}
