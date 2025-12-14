import { createStore } from "solid-js/store"
import { createMemo, onMount } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { Project } from "@opencode-ai/sdk/v2"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const [store, setStore] = makePersisted(
      createStore({
        projects: [] as { worktree: string; expanded: boolean }[],
        sidebar: {
          opened: false,
          width: 280,
        },
        terminal: {
          opened: false,
          height: 280,
        },
        review: {
          state: "pane" as "pane" | "tab",
        },
      }),
      {
        name: "layout.v2",
      },
    )

    const usedColors = new Set<AvatarColorKey>()

    function pickAvailableColor(): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !usedColors.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const metadata = globalSync.data.project.find((x) => x.worktree === project.worktree)
      if (!metadata) return []
      return [
        {
          ...project,
          ...metadata,
        },
      ]
    }

    function colorize(project: Project & { expanded: boolean }) {
      if (project.icon?.color) return project
      const color = pickAvailableColor()
      usedColors.add(color)
      project.icon = { ...project.icon, color }
      globalSdk.client.project.update({ projectID: project.id, icon: { color } })
      return project
    }

    const enriched = createMemo(() => store.projects.flatMap(enrich))
    const list = createMemo(() => enriched().flatMap(colorize))

    onMount(() => {
      Promise.all(
        store.projects.map((project) => {
          return globalSync.project.loadSessions(project.worktree)
        }),
      )
    })

    return {
      projects: {
        list,
        open(directory: string) {
          if (store.projects.find((x) => x.worktree === directory)) return
          globalSync.project.loadSessions(directory)
          setStore("projects", (x) => [{ worktree: directory, expanded: true }, ...x])
        },
        close(directory: string) {
          setStore("projects", (x) => x.filter((x) => x.worktree !== directory))
        },
        expand(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.worktree === directory ? { ...x, expanded: true } : x)))
        },
        collapse(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.worktree === directory ? { ...x, expanded: false } : x)))
        },
        move(directory: string, toIndex: number) {
          setStore("projects", (projects) => {
            const fromIndex = projects.findIndex((x) => x.worktree === directory)
            if (fromIndex === -1 || fromIndex === toIndex) return projects
            const result = [...projects]
            const [item] = result.splice(fromIndex, 1)
            result.splice(toIndex, 0, item)
            return result
          })
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
      },
      terminal: {
        opened: createMemo(() => store.terminal.opened),
        open() {
          setStore("terminal", "opened", true)
        },
        close() {
          setStore("terminal", "opened", false)
        },
        toggle() {
          setStore("terminal", "opened", (x) => !x)
        },
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        state: createMemo(() => store.review?.state ?? "closed"),
        pane() {
          setStore("review", "state", "pane")
        },
        tab() {
          setStore("review", "state", "tab")
        },
      },
    }
  },
})
