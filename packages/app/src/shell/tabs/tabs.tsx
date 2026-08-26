import type { SessionInfo } from "@opencode-ai/client/promise"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted, removePersisted, draftPersistedKeys } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { createEffect, getOwner, onCleanup, startTransition } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { usePlatform } from "@/runtime/platform/platform"
import { uuid } from "@/runtime/persistence/uuid"
import { SessionTabsRemovedDetail } from "@/shell/titlebar/session-events"
import { sessionHref } from "@/shell/routes/session"
import { createTabMemory } from "./memory"
import { nextTabAfterClose, pushClosedTab, removeClosedTabs, takeClosedTab, type ClosedTab } from "./closed"
import { createDraftComposerState, type PromptModel } from "@/composer/state"
import { migrateTabs } from "./migration"
import { useCurrentRoute } from "@/shell/state/layout"

export type SessionTab = {
  type: "session"
  server: ServerConnection.Key
  sessionId: string
  routeSessionId?: string
  routeParentId?: string
}

export type DraftTab = {
  type: "draft"
  draftID: string
  server: ServerConnection.Key
  directory: string
  worktree?: string
  branch?: string
}

export type Tab = SessionTab | DraftTab

export type TabInfo = {
  title?: string
  directory?: string
}

type RecentTab = {
  key?: string
}

export const draftHref = (draftID: string) => `/new-session?draftId=${encodeURIComponent(draftID)}`

export const tabHref = (tab: Tab) =>
  tab.type === "draft" ? draftHref(tab.draftID) : sessionHref(tab.server, tab.routeSessionId ?? tab.sessionId)

export const tabKey = (tab: Tab) =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${sessionHref(tab.server, tab.sessionId)}`

export function sessionHasOpenTab(tabs: Tab[], server: ServerConnection.Key, session: SessionInfo) {
  return sessionIDHasOpenTab(tabs, server, session.id)
}

export function sessionIDHasOpenTab(tabs: Tab[], server: ServerConnection.Key, sessionID: string) {
  return tabs.some(
    (tab) =>
      tab.type === "session" &&
      tab.server === server &&
      (tab.sessionId === sessionID || tab.routeSessionId === sessionID),
  )
}

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: () => {
    const servers = useServers()
    const platform = usePlatform()
    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.window("tabs"),
        migrate: migrateTabs,
      },
      createStore<Tab[]>([]),
    )
    const [recent, setRecent, , recentReady] = persisted(Persist.window("tabs.recent"), createStore<RecentTab>({}))
    const [info, setInfo, , infoReady] = persisted(
      Persist.window("tabs.info"),
      createStore<Record<string, TabInfo>>({}),
    )
    const [closed, setClosed, , closedReady] = persisted(Persist.window("tabs.closed"), createStore<ClosedTab[]>([]))

    const params = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const memory = createTabMemory(getOwner())
    const currentRoute = useCurrentRoute()

    const closing = new Set<string>()
    let recentWrite = 0
    let recentValue: string | undefined

    const recentKey = () => (recentWrite ? recentValue : recent.key)

    const setRecentKey = (key: string | undefined) => {
      const write = ++recentWrite
      recentValue = key
      if (recentReady()) {
        setRecent("key", key)
        return
      }
      void recentReady.promise?.then(() => {
        if (write === recentWrite) setRecent("key", key)
      })
    }

    const updateClosed = (update: (stack: ClosedTab[]) => ClosedTab[]) => {
      const apply = () => setClosed((stack) => update(stack))
      if (closedReady()) {
        apply()
        return
      }
      void closedReady.promise?.then(apply)
    }

    const removeDraftPersisted = (draftID: string) => {
      for (const key of draftPersistedKeys()) {
        const target = Persist.draft(draftID, key)
        removePersisted(key === "prompt" ? Persist.prompt(target) : target, platform)
      }
    }

    const removeInfo = (key: string) => {
      if (!info[key]) return
      setInfo(
        produce((draft) => {
          delete draft[key]
        }),
      )
    }

    onCleanup(memory.dispose)

    createEffect(() => {
      if (!ready() || !recentReady()) return
      const serversSet = new Set(servers.list.map(ServerConnection.key))
      const next = store.filter((tab) => serversSet.has(tab.server))
      if (next.length !== store.length) {
        for (const tab of store) {
          if (!serversSet.has(tab.server)) {
            const key = tabKey(tab)
            memory.remove(key)
            removeInfo(key)
          }
        }
        setStore(() => next)
      }
      if (recent.key && !next.some((tab) => tabKey(tab) === recent.key)) setRecentKey(undefined)
      const keys = new Set(next.map(tabKey))
      for (const key of Object.keys(info)) {
        if (!keys.has(key)) removeInfo(key)
      }
    })

    createEffect(() => {
      if (!closedReady()) return
      const serversSet = new Set(servers.list.map(ServerConnection.key))
      const next = closed.filter((entry) => serversSet.has(entry.tab.server))
      if (next.length !== closed.length) setClosed(() => next)
    })

    const navigateTab = (tab: Tab) => {
      const href = tabHref(tab)
      setRecentKey(tabKey(tab))
      navigate(href)
    }

    const removeTab = (index: number) => {
      const tab = store[index]
      if (!tab) return
      const key = tabKey(tab)
      const draftID = tab.type === "draft" ? tab.draftID : undefined
      const route = currentRoute()
      const nextTab = nextTabAfterClose(
        store,
        index,
        recentKey() === key && (route.type === "session" || route.type === "draft"),
      )
      closing.add(key)
      void startTransition(() => {
        setStore(
          produce((tabs) => {
            tabs.splice(index, 1)
          }),
        )
        if (nextTab === null) {
          setRecentKey(undefined)
          navigate("/")
        }
        if (nextTab) navigateTab(nextTab)
      }).finally(() => closing.delete(key))
      memory.remove(key)
      removeInfo(key)
      if (draftID) removeDraftPersisted(draftID)
    }

    const actions = {
      addSessionTab: (tab: Omit<SessionTab, "type">) => {
        const next = { type: "session" as const, ...tab }
        const existing = store.find((item) => tabKey(item) === tabKey(next))
        if (existing) return existing
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              if (tabs.some((item) => tabKey(item) === tabKey(next))) return
              tabs.push(next)
            }),
          )
        })
        return next
      },
      reorder(keys: string[]) {
        setStore(
          produce((tabs) => {
            const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]))
            const next = keys.map((key) => byKey.get(key)).filter((tab): tab is Tab => !!tab)
            if (next.length !== tabs.length) return
            tabs.splice(0, tabs.length, ...next)
          }),
        )
      },
      draft(draftID: string) {
        const tab = store.find((item) => item.type === "draft" && item.draftID === draftID)
        if (!tab || tab.type !== "draft") throw new Error(`Draft not found: ${draftID}`)
        return tab
      },
      async newDraft(draft: Omit<DraftTab, "type" | "draftID">, prompt?: string, model?: PromptModel) {
        const draftID = uuid()
        const tab = { type: "draft" as const, draftID, ...draft }
        memory.ensure(tabKey(tab), "prompt", () => createDraftComposerState(draftID, { prompt, model }))
        await startTransition(() => {
          setStore(
            produce((tabs) => {
              tabs.push(tab)
            }),
          )
          navigate(draftHref(draftID))
        })
        return tab
      },
      updateDraft(draftID: string, draft: Partial<Omit<DraftTab, "type" | "draftID">>) {
        void startTransition(() => {
          setStore(
            (tab) => tab.type === "draft" && tab.draftID === draftID,
            produce((tab) => Object.assign(tab, draft)),
          )
        })
      },
      initializeDraftWorktrees(server: ServerConnection.Key, directory: string, worktree: string) {
        setStore(
          (tab) => tab.type === "draft" && tab.server === server && tab.directory === directory && !tab.worktree,
          produce((tab) => {
            if (tab.type === "draft") tab.worktree = worktree
          }),
        )
      },
      promoteDraft(draftID: string, session: Omit<SessionTab, "type">) {
        // Keep the replacement and navigation atomic so /new-session never renders
        // after its backing draft tab has been removed from the store.
        const active = location.pathname === "/new-session" && location.query.draftId === draftID
        const next = { type: "session" as const, ...session }
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              const index = tabs.findIndex((tab) => tab.type === "draft" && tab.draftID === draftID)
              if (index !== -1) tabs[index] = next
            }),
          )
          if (recent.key === `draft:${draftID}`) setRecentKey(tabKey(next))
          if (active) navigateTab(next)
        })
        memory.remove(`draft:${draftID}`)
        removeDraftPersisted(draftID)
      },
      removeTab,
      // User-initiated close: records the tab so it can be reopened.
      // Cleanup paths (missing sessions, archive, server removal) go through
      // removeTab and friends directly and are not recorded.
      closeTab(index: number) {
        const tab = store[index]
        if (!tab) return
        if (tab.type === "session") updateClosed((stack) => pushClosedTab(stack, tab, index))
        removeTab(index)
      },
      reopenClosedTab() {
        if (!closedReady()) {
          void closedReady.promise?.then(() => actions.reopenClosedTab())
          return
        }
        const result = takeClosedTab(closed, store)
        if (result.stack.length === closed.length) return
        setClosed(() => result.stack)
        const entry = result.entry
        if (!entry) return
        const index = Math.min(entry.index, store.length)
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              if (tabs.some((item) => tabKey(item) === tabKey(entry.tab))) return
              tabs.splice(index, 0, entry.tab)
            }),
          )
          navigateTab(entry.tab)
        })
      },
      removeSessionTab(input: Omit<SessionTab, "type">) {
        updateClosed((stack) => removeClosedTabs(stack, input.server, [input.sessionId]))
        const index = store.findIndex(
          (tab) =>
            tab.type === "session" &&
            tab.server === input.server &&
            (tab.sessionId === input.sessionId || tab.routeSessionId === input.sessionId),
        )
        if (index !== -1) removeTab(index)
      },
      removeServer(key: ServerConnection.Key) {
        updateClosed((stack) => stack.filter((entry) => entry.tab.server !== key))
        const drafts = store.flatMap((tab) => (tab.type === "draft" && tab.server === key ? [tab.draftID] : []))
        const removed = store.filter((tab) => tab.server === key).map(tabKey)
        setStore((tabs) => tabs.filter((tab) => tab.server !== key))
        for (const key of removed) memory.remove(key)
        for (const key of removed) removeInfo(key)
        if (recent.key && removed.includes(recent.key)) setRecentKey(undefined)
        for (const draftID of drafts) removeDraftPersisted(draftID)
      },
      removeSessions: (input: SessionTabsRemovedDetail) => {
        const targetServer = input.server
        updateClosed((stack) => removeClosedTabs(stack, targetServer, input.sessionIDs))
        const removed = store
          .filter(
            (tab) => tab.type === "session" && tab.server === targetServer && input.sessionIDs.includes(tab.sessionId),
          )
          .map(tabKey)
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              const sessionIDs = new Set(input.sessionIDs)
              const route = currentRoute()
              const sessionRoute = route.type === "session" ? route : undefined
              const currentIndex = sessionRoute
                ? tabs.findIndex(
                    (tab) =>
                      tab.type === "session" &&
                      tab.server === sessionRoute.server &&
                      tab.sessionId === sessionRoute.sessionId,
                  )
                : -1
              const currentTab = tabs[currentIndex]
              const removedCurrent =
                currentTab?.type === "session" &&
                currentTab.server === targetServer &&
                sessionIDs.has(currentTab.sessionId)

              for (let i = tabs.length - 1; i >= 0; i--) {
                const tab = tabs[i]
                if (!tab || tab.type !== "session") continue
                if (tab.server !== targetServer) continue
                if (!sessionIDs.has(tab.sessionId)) continue
                tabs.splice(i, 1)
              }

              if (!removedCurrent) return
              const nextTab =
                tabs.slice(currentIndex).find((tab) => tab.type === "session") ??
                tabs.slice(0, currentIndex).findLast((tab) => tab.type === "session")
              if (nextTab) navigateTab(nextTab)
              else navigate("/")
            }),
          )
          if (recent.key && removed.includes(recent.key)) setRecentKey(undefined)
        })
        for (const key of removed) memory.remove(key)
        for (const key of removed) removeInfo(key)
      },
      rememberSessionInfo(tab: SessionTab, session: SessionInfo) {
        const key = tabKey(tab)
        const next = { title: session.title, directory: session.location.directory }
        const current = info[key]
        if (current && current.title === next.title && current.directory === next.directory) return
        console.debug("[tabs] update persisted session info", { key, sessionID: session.id, current, next })
        setInfo(key, next)
      },
      select: navigateTab,
      remember(tab: Tab) {
        const key = tabKey(tab)
        if (recentKey() !== key) setRecentKey(key)
      },
      rememberSessionRoute(tab: SessionTab, sessionId: string, parentId?: string) {
        const index = store.findIndex((item) => tabKey(item) === tabKey(tab))
        if (index === -1) return
        setStore(
          index,
          produce((item) => {
            if (item.type !== "session") return
            item.routeSessionId = sessionId === item.sessionId ? undefined : sessionId
            item.routeParentId = sessionId === item.sessionId ? undefined : parentId
          }),
        )
      },
      toggleHome(input: { home: boolean; current?: Tab }) {
        if (input.home) {
          const tab = store.find((tab) => tabKey(tab) === recentKey())
          if (tab) navigateTab(tab)
          return
        }
        if (input.current) {
          setRecentKey(tabKey(input.current))
          navigate("/")
          return
        }
        navigate("/")
      },
      state<T>(tab: Tab, name: string, init: () => T) {
        return memory.ensure(tabKey(tab), name, init)
      },
      stateValue<T>(tab: Tab, name: string) {
        return memory.get<T>(tabKey(tab), name)
      },
    }

    return { ...actions, store, info, ready, infoReady, recentReady }
  },
})
