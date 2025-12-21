import { createStore, produce } from "solid-js/store"
import { batch, createMemo, onMount } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { Project } from "@opencode-ai/sdk/v2"
import { persisted } from "@/utils/persist"

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

type SessionTabs = {
  active?: string
  all: string[]
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const [store, setStore, _, ready] = persisted(
      "layout.v3",
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
        session: {
          width: 600,
        },
        sessionTabs: {} as Record<string, SessionTabs>,
      }),
    )

    const usedColors = new Set<AvatarColorKey>()

    function pickAvailableColor(): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !usedColors.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const metadata = globalSync.data.project.find((x) => x.worktree === project.worktree)
      return [
        {
          ...project,
          ...(metadata ?? {}),
        },
      ]
    }

    function colorize(project: LocalProject) {
      if (project.icon?.color) return project
      const color = pickAvailableColor()
      usedColors.add(color)
      project.icon = { ...project.icon, color }
      if (project.id) {
        globalSdk.client.project.update({ projectID: project.id, icon: { color } })
      }
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
      ready,
      projects: {
        list,
        open(directory: string) {
          if (store.projects.find((x) => x.worktree === directory)) {
            return
          }
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
      session: {
        width: createMemo(() => store.session?.width ?? 600),
        resize(width: number) {
          if (!store.session) {
            setStore("session", { width })
          } else {
            setStore("session", "width", width)
          }
        },
      },
      tabs(sessionKey: string) {
        const tabs = createMemo(() => store.sessionTabs[sessionKey] ?? { all: [] })
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all),
          setActive(tab: string | undefined) {
            if (!store.sessionTabs[sessionKey]) {
              setStore("sessionTabs", sessionKey, { all: [], active: tab })
            } else {
              setStore("sessionTabs", sessionKey, "active", tab)
            }
          },
          setAll(all: string[]) {
            if (!store.sessionTabs[sessionKey]) {
              setStore("sessionTabs", sessionKey, { all, active: undefined })
            } else {
              setStore("sessionTabs", sessionKey, "all", all)
            }
          },
          async open(tab: string) {
            const current = store.sessionTabs[sessionKey] ?? { all: [] }
            if (tab !== "review") {
              if (!current.all.includes(tab)) {
                if (!store.sessionTabs[sessionKey]) {
                  setStore("sessionTabs", sessionKey, { all: [tab], active: tab })
                } else {
                  setStore("sessionTabs", sessionKey, "all", [...current.all, tab])
                  setStore("sessionTabs", sessionKey, "active", tab)
                }
                return
              }
            }
            if (!store.sessionTabs[sessionKey]) {
              setStore("sessionTabs", sessionKey, { all: [], active: tab })
            } else {
              setStore("sessionTabs", sessionKey, "active", tab)
            }
          },
          close(tab: string) {
            const current = store.sessionTabs[sessionKey]
            if (!current) return
            batch(() => {
              setStore(
                "sessionTabs",
                sessionKey,
                "all",
                current.all.filter((x) => x !== tab),
              )
              if (current.active === tab) {
                const index = current.all.findIndex((f) => f === tab)
                const previous = current.all[Math.max(0, index - 1)]
                setStore("sessionTabs", sessionKey, "active", previous)
              }
            })
          },
          move(tab: string, to: number) {
            const current = store.sessionTabs[sessionKey]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            setStore(
              "sessionTabs",
              sessionKey,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
      },
    }
  },
})
