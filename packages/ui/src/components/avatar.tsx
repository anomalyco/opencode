import { type ComponentProps, splitProps, Show } from "solid-js"

export interface AvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  background?: string
  size?: "small" | "normal" | "large"
}

export function Avatar(props: AvatarProps) {
  const [split, rest] = splitProps(props, ["fallback", "src", "background", "size", "class", "classList", "style"])
  return (
    <div
      {...rest}
      data-component="avatar"
      data-size={split.size || "normal"}
      data-has-image={split.src ? "" : undefined}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
      style={{
        ...(typeof split.style === "object" ? split.style : {}),
        ...(!split.src && split.background ? { "--avatar-bg": split.background } : {}),
      }}
    >
      <Show when={split.src} fallback={split.fallback?.[0]}>
        {(src) => <img src={src()} draggable={false} class="size-full object-cover" />}
      </Show>
    </div>
  )
}
