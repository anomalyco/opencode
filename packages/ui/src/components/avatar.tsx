import { type ComponentProps, splitProps, Show } from "solid-js"

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string) {
  if (!value) return ""
  if (!segmenter) return Array.from(value)[0] ?? ""
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? Array.from(value)[0] ?? ""
}

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
  return (
    <div
      {...rest}
      data-component="avatar"
      data-size={split.size || "normal"}
      data-has-image={split.src ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={{
        ...(typeof split.style === "object" ? split.style : {}),
        ...(!split.src && split.background ? { "--avatar-bg": split.background } : {}),
        ...(!split.src && split.foreground ? { "--avatar-fg": split.foreground } : {}),
      }}
    >
      <Show when={split.src} fallback={first(split.fallback)}>
        {(src) => <img src={src()} draggable={false} data-slot="avatar-image" />}
      </Show>
    </div>
  )
}
