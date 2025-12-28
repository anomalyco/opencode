import { type ComponentProps, splitProps, Show } from "solid-js"

export interface AvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  background?: string
  foreground?: string
  size?: "small" | "normal" | "large"
}

export function Avatar(props: AvatarProps) {
  const [split, rest] = splitProps(props, [
    "fallback",
    "src",
    "background",
    "foreground",
    "size",
    "class",
    "classList",
    "style",
  ])
  const src = split.src // did this so i can zero it out to test fallback
  return (
    <div
      {...rest}
      data-component="avatar"
      data-size={split.size || "normal"}
      data-has-image={src ? "" : undefined}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
      style={{
        ...(typeof split.style === "object" ? split.style : {}),
        ...(!src && split.background ? { "--avatar-bg": split.background } : {}),
        ...(!src && split.foreground ? { "--avatar-fg": split.foreground } : {}),
      }}
    >
      <Show when={src} fallback={split.fallback?.[0]}>
        {(src) => <img src={src()} draggable={false} class="size-full object-cover" />}
      </Show>
    </div>
  )
}
