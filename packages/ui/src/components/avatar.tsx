import { type ComponentProps, splitProps, Show } from "solid-js"

export interface AvatarProps extends ComponentProps<"div"> {
  fallback: string
  background?: string
  size?: "small" | "normal" | "large"
}

export function Avatar(props: AvatarProps) {
  const [split, rest] = splitProps(props, ["fallback", "background", "size", "class", "classList", "style"])
  return (
    <div
      {...rest}
      data-component="avatar"
      data-size={split.size || "normal"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
      style={{
        ...(typeof split.style === "object" ? split.style : {}),
        ...(split.background ? { "--avatar-bg": split.background } : {}),
      }}
    >
      <Show when={split.fallback}>{split.fallback[0]}</Show>
    </div>
  )
}
