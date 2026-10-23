import {
  type ComponentProps,
  createContext,
  createEffect,
  createMemo,
  onCleanup,
  createSignal,
  onMount,
  splitProps,
  Show,
  useContext,
} from "solid-js"
import { motionTuning } from "../../motion-tuning"
import { attachGeneratedAvatar } from "./animation"
import {
  generateProjectIcon,
  GENERATED_PROJECT_ICON_STYLE,
  type GeneratedProjectIcon,
} from "./generated"
import "./project-avatar.css"

export { generateProjectIcon, GENERATED_PROJECT_ICON_STYLE, type GeneratedProjectIcon } from "./generated"

const avatarChoice = motionTuning.choice("projectAvatar.style", {
  label: "Style",
  group: "Experiments",
  card: "Project avatars",
  order: 20,
  description: "The mark for projects without an icon, on Home and in tabs.",
  target: '[data-component="project-avatar-v2"]',
  value: "letters",
  labels: { letters: "Letters", generated: "Generated" },
})

const [avatarStyle, setAvatarStyle] = createSignal(avatarChoice())

// A live switch crossfades the avatars through a view transition; nothing else on the page changes.
motionTuning.subscribe(() => {
  if (avatarChoice() === avatarStyle()) return

  if (typeof document === "undefined" || !document.startViewTransition) return setAvatarStyle(avatarChoice())
  document.startViewTransition(() => setAvatarStyle(avatarChoice()))
})

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

// "outline" is a neutral, muted style (e.g. recently closed projects) and is not part of the color rotation.
export type ProjectAvatarStyle = ProjectAvatarVariant | "outline"

// Project IDs hash the normalized origin remote (`git-remote:github.com/anomalyco/opencode`); V1 used the root commit.
const OPENCODE_PROJECT_IDS = new Set([
  "012780c4098d08caa4ea8c479ed0a4690489f38d",
  "476fbfe6befa9e63ddd7f9ae71655999a0104256",
  "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750",
])

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (icon?.override) return icon.override

  if (icon?.color) return undefined

  if (id && OPENCODE_PROJECT_IDS.has(id)) return "https://opencode.ai/favicon.svg"

  return icon?.url
}

export function getProjectAvatarVariant(key?: string): ProjectAvatarVariant {
  if (key === "mint") return "cyan"

  if (key === "lime") return "green"

  if (
    key === "orange" ||
    key === "yellow" ||
    key === "cyan" ||
    key === "green" ||
    key === "red" ||
    key === "pink" ||
    key === "blue" ||
    key === "purple" ||
    key === "gray"
  )
    return key

  return "gray"
}

/**
 * Keeps each project's generated avatar once it has been drawn, so it stays identical after restarts and after the
 * generator's defaults change. Without a store, avatars are derived from their key every time.
 */
export type ProjectIconStore = {
  get: (key: string) => GeneratedProjectIcon | undefined
  remember: (key: string, icon: GeneratedProjectIcon) => void
}

const ProjectIconStoreContext = createContext<ProjectIconStore>()

export const ProjectIconStoreProvider = ProjectIconStoreContext.Provider

/**
 * The key that seeds the generated default avatar: the project ID, or the directory for projects without one. There
 * is none when the project shows a chosen or discovered image or a chosen color.
 */
export function getProjectAvatarGenerated(project?: {
  id?: string
  worktree?: string
  icon?: { color?: string; url?: string; override?: string }
}) {
  if (!project || getProjectAvatarSource(project.id, project.icon) || project.icon?.color) return

  return project.id && project.id !== "global" ? project.id : project.worktree || undefined
}

export const displayName = (project: { name?: string; worktree: string }) => {
  const trimmed = project.worktree.replace(/[/\\]+$/, "")
  const filename = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1)

  return project.name || filename || project.worktree
}

export interface ProjectAvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  variant?: ProjectAvatarStyle
  unread?: boolean
  /** Seeds the generated default avatar shown when there is no image; see getProjectAvatarGenerated. */
  generated?: string
}

export function ProjectAvatar(props: ProjectAvatarProps) {
  const [split, rest] = splitProps(props, [
    "fallback",
    "src",
    "variant",
    "unread",
    "generated",
    "class",
    "classList",
    "style",
  ])

  const generated = () =>
    split.src || split.variant === "outline" || avatarStyle() === "letters" ? undefined : split.generated

  return (
    <div
      {...rest}
      data-component="project-avatar-v2"
      data-unread={split.unread ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={split.style}
    >
      <div
        data-slot="project-avatar-surface"
        data-variant={split.variant ?? "gray"}
        data-has-image={split.src ? "" : undefined}
        data-generated={generated() ? "" : undefined}
      >
        <Show
          when={split.src}
          fallback={
            <Show when={generated()} fallback={first(split.fallback)}>
              {(key) => <GeneratedAvatar seed={key()} />}
            </Show>
          }
        >
          {(value) => <img src={value()} draggable={false} data-slot="project-avatar-image" />}
        </Show>
      </div>
      <Show when={split.unread}>
        <span data-slot="project-avatar-unread-dot" aria-hidden="true" />
      </Show>
    </div>
  )
}

function GeneratedAvatar(props: { seed: string }) {
  const store = useContext(ProjectIconStoreContext)

  const stored = () => {
    const icon = store?.get(props.seed)

    // An icon from another generator style is replaced, so every project shows the current style.
    return icon?.style === GENERATED_PROJECT_ICON_STYLE ? icon : undefined
  }

  const icon = createMemo(() => stored() ?? generateProjectIcon(props.seed))
  let canvas!: HTMLCanvasElement

  onMount(() => {
    const avatar = attachGeneratedAvatar(canvas, icon)

    onCleanup(avatar.dispose)
    createEffect(() => {
      icon()
      avatar.refresh()
    })
    createEffect(() => {
      if (store && !stored()) store.remember(props.seed, icon())
    })
  })

  return <canvas ref={canvas} data-slot="project-avatar-generated" aria-hidden="true" />
}
