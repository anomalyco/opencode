import { first } from "../../utils/first"
import { type ComponentProps, splitProps, Show } from "solid-js"
import "./project-avatar-v2.css"

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
      data-unread={split.unread ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={typeof split.style === "object" ? split.style : undefined}
    >
      <div
        data-slot="project-avatar-surface"
        data-variant={split.variant ?? "gray"}
        data-has-image={src ? "" : undefined}
        data-loading={split.loading ? "" : undefined}
      >
        <Show when={src} fallback={first(split.fallback)}>
          {(value) => <img src={value()} draggable={false} data-slot="project-avatar-image" />}
        </Show>
        <Show when={split.loading}>
          <span data-slot="project-avatar-loader" aria-hidden="true" />
        </Show>
      </div>
      <Show when={split.unread}>
        <span data-slot="project-avatar-unread-dot" aria-hidden="true" />
      </Show>
    </div>
  )
}
