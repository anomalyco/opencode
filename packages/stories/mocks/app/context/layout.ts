import { useLocation } from "../../solid-router"
import { createSignal, type ParentProps } from "solid-js"
import type { ServerConnection } from "@/runtime/server/registry"
import type { Project } from "@/runtime/server/types"

export type LocalProject = Partial<Project> & { worktree: string; expanded?: boolean }

export type LayoutRoute =
  | { type: "home" }
  | { type: "settings" }
  | { type: "connect" }
  | { type: "components" }
  | { type: "draft"; draftID: string }
  | { type: "session"; sessionId: string; server: ServerConnection.Key }

export function currentRoute(pathname: string, search: string): LayoutRoute {
  const parts = pathname.split("/").filter(Boolean)

  if (parts.length === 0) return { type: "home" }

  if (parts[0] === "settings") return { type: "settings" }

  if (parts[0] === "connect") return { type: "connect" }

  if (parts[0] === "components") return { type: "components" }

  if (parts[0] === "new-session") {
    const draftID = new URLSearchParams(search).get("draftId")

    return draftID ? { type: "draft", draftID } : { type: "home" }
  }

  return { type: "home" }
}

export function getProjectAvatarVariant(key?: string) {
  if (key === "mint") return "cyan" as const

  if (key === "lime") return "green" as const

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

  return "gray" as const
}

const [all, setAll] = createSignal<string[]>([])

const [active, setActive] = createSignal<string | undefined>(undefined)

const [sideOpen, setSideOpen] = createSignal(false)

export function useCurrentRoute() {
  const location = useLocation()

  return () => currentRoute(location.pathname, location.search)
}

const tabs = {
  all,
  active,
  open(tab: string) {
    setAll((current) => (current.includes(tab) ? current : [...current, tab]))
  },
  setActive(tab: string) {
    if (!all().includes(tab)) {
      tabs.open(tab)
    }

    setActive(tab)
  },
}

const view = {
  side: {
    opened: sideOpen,
    toggle() {
      setSideOpen((opened) => !opened)
    },
  },
}

export function LayoutProvider(props: ParentProps) {
  return props.children
}

export function useLayout() {
  const route = useCurrentRoute()

  return {
    route,
    home: {
      selection: () => ({ server: undefined as string | undefined, directory: undefined as string | undefined }),
    },
    tabs: () => tabs,
    view: () => view,
    fileTree: {
      setTab() {},
    },
    handoff: {
      setTabs() {},
    },
  }
}
