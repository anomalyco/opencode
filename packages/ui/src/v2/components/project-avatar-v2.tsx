import { type ComponentProps, splitProps, Show } from "solid-js"
import "./project-avatar-v2.css"

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string) {
  if (!value) return ""
  if (!segmenter) return Array.from(value)[0] ?? ""
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? Array.from(value)[0] ?? ""
}

export const PROJECT_AVATAR_VARIANTS = [
  "orange",
  "yellow",
  "cyan",
  "green",
  "red",
  "pink",
  "blue",
  "purple",
  "gray",
] as const

export type ProjectAvatarVariant = (typeof PROJECT_AVATAR_VARIANTS)[number]

export interface ProjectAvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  variant?: ProjectAvatarVariant
  unread?: boolean
  loading?: boolean
}

export function ProjectAvatar(props: ProjectAvatarProps) {
  const [split, rest] = splitProps(props, [
    "fallback",
    "src",
    "variant",
    "unread",
    "loading",
    "class",
    "classList",
    "style",
  ])
  const src = split.src
  return (
    <div
      {...rest}
      data-component="project-avatar-v2"
      data-variant={split.variant ?? "gray"}
      data-has-image={src ? "" : undefined}
      data-unread={split.unread ? "" : undefined}
      data-loading={split.loading ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={typeof split.style === "object" ? split.style : undefined}
    >
      <Show when={src} fallback={first(split.fallback)}>
        {(value) => <img src={value()} draggable={false} data-slot="project-avatar-image" />}
      </Show>
      <Show when={split.loading}>
        <span data-slot="project-avatar-loader" aria-hidden="true" />
      </Show>
    </div>
  )
}
