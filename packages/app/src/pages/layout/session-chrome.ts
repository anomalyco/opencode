import { makeEventListener } from "@solid-primitives/event-listener"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createResource, untrack, on } from "solid-js"
import { createStore } from "solid-js/store"
import { applyPath, backPath, forwardPath } from "@/components/titlebar-history"
import { readSessionTabsRemovedDetail, SESSION_TABS_REMOVED_EVENT } from "@/components/titlebar-session-events"
import { useCommand } from "@/context/command"
import { useGlobal } from "@/context/global"
import { LayoutRoute, useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import type { PromptSession } from "@/context/prompt"
import { ServerConnection, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { normalizeSessionInfo } from "@/utils/session"

export function useV2SessionChrome() {
  const layout = useLayout()
  const global = useGlobal()
  const server = useServer()
  const tabs = useTabs()
  const command = useCommand()
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const tabsStore = tabs.store
  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })
  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = path()
    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  const [session] = createResource(
    () => {
      const route = layout.route()
      if (route.type !== "session") return undefined
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === (route.server ?? server.key))
      return conn ? { route, sdk: global.ensureServerCtx(conn).sdk } : undefined
    },
    ({ route, sdk }) =>
      sdk.api.session
        .get({ sessionID: route.sessionId })
        .then(normalizeSessionInfo)
        .catch(() => {}),
  )

  const matchRoute = (route: LayoutRoute) => {
    if (route.type === "home") return
    if (route.type === "draft") {
      return tabsStore.find((item) => item.type === "draft" && item.draftID === route.draftID)
    }
    if (route.type !== "session") return
    const main = tabsStore.find(
      (item) => item.type === "session" && item.server === route.server && item.sessionId === route.sessionId,
    )
    if (main) return main
    const current = session()
    if (!current?.parentID) return
    return tabsStore.find(
      (item) => item.type === "session" && item.server === route.server && item.sessionId === current.parentID,
    )
  }

  const currentTab = () => matchRoute(layout.route())

  createEffect(
    on(
      () => [layout.route().type, tabs.ready()] as const,
      ([type, ready]) => {
        if (!ready) return
        if (type === "session" || type === "home") tabs.discardUnusedDrafts()
      },
    ),
  )

  createEffect(() => {
    const route = layout.route()
    if (!tabs.ready()) return
    const tab = currentTab()
    if (tab) {
      tabs.remember(tab)
      return
    }
    if (route.type !== "session") return
    const current = session()
    if (!current) return
    tabs.addSessionTab({ server: route.server ?? server.key, sessionId: current.parentID ?? current.id })
  })

  makeEventListener(window, SESSION_TABS_REMOVED_EVENT, (event) => {
    const detail = readSessionTabsRemovedDetail(event)
    if (!detail) return
    tabs.removeSessions(detail)
  })

  const openNewTab = () => {
    const route = layout.route()
    const activeSession = session()
    if (route.type === "session" && activeSession) {
      const model = untrack(() =>
        tabs.stateValue<PromptSession>(
          { type: "session", server: route.server ?? server.key, sessionId: activeSession.id },
          "prompt",
        )?.model.current(),
      )
      void tabs.newDraft({ server: route.server ?? server.key, directory: activeSession.directory }, "", model)
      return
    }

    const activeTab = currentTab()
    if (activeTab?.type === "draft") {
      const model = untrack(() => tabs.stateValue<PromptSession>(activeTab, "prompt")?.model.current())
      void tabs.newDraft({ server: activeTab.server, directory: activeTab.directory }, "", model)
      return
    }

    if (route.type === "home") {
      const selection = layout.home.selection()
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === selection.server)
      const project = conn
        ? global
            .ensureServerCtx(conn)
            .projects.list()
            .find((item) => item.worktree === selection.directory)
        : undefined
      if (conn && project) {
        void tabs.newDraft({ server: ServerConnection.key(conn), directory: project.worktree }, "")
        return
      }
    }

    const current = layout.projects.list()[0]
    if (current) {
      void tabs.newDraft({ server: server.key, directory: current.worktree }, "")
      return
    }

    const fallback = global.servers.list().flatMap((conn) => {
      const project = global.ensureServerCtx(conn).projects.list()[0]
      return project ? [{ server: ServerConnection.key(conn), project }] : []
    })[0]
    if (!fallback) return
    void tabs.newDraft({ server: fallback.server, directory: fallback.project.worktree }, "")
  }

  const toggleHome = () => tabs.toggleHome({ home: layout.route().type === "home", current: currentTab() })

  command.register("titlebar-home", () => [
    {
      id: "home.toggle",
      title: language.t("home.title"),
      category: language.t("command.category.view"),
      hidden: true,
      onSelect: toggleHome,
    },
  ])

  command.register("sidebar", () => [
    {
      id: "sidebar.toggle",
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      onSelect: () => layout.historyTree.toggle(),
    },
  ])

  command.register("tabs", () => {
    const current = currentTab()
    return [
      {
        id: "tab.new",
        category: "tab",
        title: language.t("command.session.new"),
        keybind: "mod+t,mod+n",
        hidden: true,
        onSelect: openNewTab,
      },
      current && {
        id: "tab.close",
        category: "tab",
        title: language.t("command.tab.close"),
        keybind: "mod+w",
        hidden: true,
        onSelect: () => {
          tabs.closeTab(tabsStore.findIndex((tab) => current === tab))
        },
      },
      {
        id: "tab.reopenClosed",
        category: language.t("command.category.file"),
        title: language.t("command.tab.reopenClosed"),
        keybind: "mod+shift+t",
        onSelect: () => tabs.reopenClosedTab(),
      },
    ].filter((item) => item !== undefined)
  })

  return { openNewTab, toggleHome, currentTab }
}
