import { ComponentProps, Show, splitProps } from "solid-js"

export interface SkeletonProps extends ComponentProps<"div"> {
  variant?: "text" | "circular" | "rectangular"
  width?: string | number
  height?: string | number
  animated?: boolean
}

export function Skeleton(props: SkeletonProps) {
  const [split, rest] = splitProps(props, [
    "variant",
    "width",
    "height",
    "animated",
    "class",
    "classList",
  ])

  const variant = () => split.variant ?? "text"
  const animated = () => split.animated ?? true

  return (
    <div
      {...rest}
      data-component="skeleton"
      data-variant={variant()}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
      style={{
        width: split.width,
        height: split.height,
        ...rest.style,
      }}
    >
      <Show when={animated()}>
        <div class="skeleton-shimmer w-full h-full rounded-inherit" />
      </Show>
    </div>
  )
}
