import type { SessionInfo, SessionMessageUser } from "@opencode/client/promise"
import type { ComposerSelection } from "@/composer/adapter"
import { createSimpleContext } from "@opencode/ui/context"
import { produce } from "solid-js/store"
import { Persist, persisted, removePersisted, draftPersistedKeys } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { usePluginServers } from "@/runtime/plugin/servers"
import { createEffect, createSignal, getOwner, onCleanup, startTransition, untrack, type Accessor } from "solid-js"
import type { NewSessionStartView } from "@/new-session/machine"
import { useLocation, useNavigate } from "@solidjs/router"
import { usePlatform } from "@/runtime/platform/platform"
import { uuid } from "@opencode/util/uuid"
import { SessionTabsRemovedDetail } from "@/shell/titlebar/session-events"
import { sessionHref } from "@/shell/routes/session"
import { createTabMemory } from "./memory"
import { createSessionPreview } from "./preview"
import { nextTabAfterClose, pushClosedTab, removeClosedTabs, takeClosedTab, type ClosedTab } from "./closed"
import {
  createDraftComposerState,
  createMemoryComposerState,
  type ComposerState,
  type PromptModel,
} from "@/composer/state"
import { appendPrompt, promptLength } from "@/composer/prompt-parts"
import { TabStorage } from "./schema"
import { useCurrentRoute, type LayoutRoute } from "@/shell/state/layout"
import {
  INITIAL_TAB_PROMOTION_STATE,
  pendingPromotion,
  runsAfterCommit,
  transitionTabPromotion,
  type ComposerTarget,
  type TabPromotionCommit,
  type TabPromotionEffect,
  type TabPromotionEvent,
} from "./promotion-machine"
import {
  createTabsHydrationState,
  selectRecentTabKey,
  transitionTabsHydration,
  type TabsHydrationEffect,
  type TabsHydrationEvent,
} from "./hydration-machine"

export type SessionTab = typeof TabStorage.Session.Type

export type DraftTab = typeof TabStorage.Draft.Type

export type Tab = typeof TabStorage.Tab.Type

export type PendingSession = {
  draft: DraftTab
  message: SessionMessageUser
  selection: ComposerSelection
  composer: ComposerState
  view: Accessor<NewSessionStartView>
}

export type TabInfo = typeof TabStorage.Info.Type

export type TabRegion = "side" | "bottom"

export type TabRegionSize = "sessionWidth" | "bottomHeight" | "splitRatio"

export const draftHref = (draftID: string) => `/new-session?draftId=${encodeURIComponent(draftID)}`

export const tabHref = (tab: Tab) =>
  tab.type === "draft" ? draftHref(tab.draftID) : sessionHref(tab.server, tab.routeSessionId ?? tab.sessionId)

export const tabKey = (tab: Tab) =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${sessionHref(tab.server, tab.sessionId)}`

export function sessionHasOpenTab(tabs: Tab[], server: ServerConnection.Key, session: SessionInfo) {
  return sessionIDHasOpenTab(tabs, server, session.id)
}

export function findSessionTab(tabs: Tab[], server: ServerConnection.Key, sessionID: string) {
  return tabs.find(
    (tab) =>
      tab.type === "session" &&
      tab.server === server &&
      (tab.sessionId === sessionID || tab.routeSessionId === sessionID),
  )
}

export function sessionIDHasOpenTab(tabs: Tab[], server: ServerConnection.Key, sessionID: string) {
  return !!findSessionTab(tabs, server, sessionID)
}

/** Whether the route shows this tab, including a session tab that shows one of its child sessions. */
export function tabMatchesRoute(tab: Tab, route: LayoutRoute) {
  if (route.type === "draft") return tab.type === "draft" && tab.draftID === route.draftID

  return route.type === "session" && sessionIDHasOpenTab([tab], route.server, route.sessionId)
}

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: () => {
    const servers = useServers()
    const pluginServers = usePluginServers()
    const platform = usePlatform()
    const [store, setStore, _, ready] = persisted(Persist.window("tabs"), TabStorage.Tabs, [])

    const [recent, setRecent, , recentReady] = persisted(Persist.window("tabs.recent"), TabStorage.Recent, {
      key: undefined,
    })

    const [info, setInfo, , infoReady] = persisted(Persist.window("tabs.info"), TabStorage.Infos, {})
    const [regions, setRegions, , regionsReady] = persisted(Persist.window("tabs.panes"), TabStorage.Regions, {})
    const [closed, setClosed, , closedReady] = persisted(Persist.window("tabs.closed"), TabStorage.Closed, [])
    const [promotion, setPromotion] = createSignal(INITIAL_TAB_PROMOTION_STATE)

    const navigate = useNavigate()
    const location = useLocation()
    const memory = createTabMemory(getOwner())
    const currentRoute = useCurrentRoute()

    const [hydration, setHydration] = createSignal(
      createTabsHydrationState({ recent: recentReady(), closed: closedReady() }),
    )

    const dispatchHydration = (event: TabsHydrationEvent) => {
      const result = transitionTabsHydration(untrack(hydration), event)
      setHydration(result.state)
      result.effects.forEach(runHydrationEffect)
    }

    const runHydrationEffect = (effect: TabsHydrationEffect) => {
      if (effect.type === "recent.commit") return setRecent("key", effect.key)
      // Each operation runs on its own, so one that throws can't drop the ones queued after it.
      effect.ops.forEach((op) =>
        Promise.try(() => {
          if (op.kind === "update") return setClosed((stack) => op.update(stack))
          reopenClosedTabNow(op.target, op.options)
        }).catch((error) => console.error("[tabs] closed tab operation failed", error)),
      )
    }

    // Both run once each store loads, or fails to and runs from its initial value.
    createEffect(() => {
      if (recentReady()) untrack(() => dispatchHydration({ type: "recent.hydrated", persistedKey: recent.key }))
    })
    createEffect(() => {
      if (closedReady()) untrack(() => dispatchHydration({ type: "closed.hydrated" }))
    })
    onCleanup(() => dispatchHydration({ type: "disposed" }))

    const recentKey = () => selectRecentTabKey(hydration(), recent.key)

    const setRecentKey = (key: string | undefined) =>
      dispatchHydration({ type: "recent.set", key, persistedKey: untrack(() => recent.key) })

    const updateClosed = (update: (stack: ClosedTab[]) => ClosedTab[]) =>
      dispatchHydration({ type: "closed.op", op: { kind: "update", update } })

    function reopenClosedTabNow(target?: SessionTab, options?: { append?: boolean }) {
      const result = takeClosedTab(closed, store, target)

      if (result.stack.length === closed.length) return
      setClosed(() => result.stack)
      const entry = result.entry

      if (!entry) return
      const index = options?.append ? store.length : Math.min(entry.index, store.length)

      if (entry.info) setInfo(tabKey(entry.tab), entry.info)
      void startTransition(() => {
        setStore(
          produce((tabs) => {
            if (tabs.some((item) => tabKey(item) === tabKey(entry.tab))) return
            tabs.splice(index, 0, entry.tab)
          }),
        )
        navigateTab(entry.tab)
      })
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

    const removeRegions = (key: string) => {
      if (!regions[key]) return
      setRegions(
        produce((draft) => {
          delete draft[key]
        }),
      )
    }

    const dispatchPromotion = (event: Exclude<TabPromotionEvent, TabPromotionCommit>) => {
      const previous = untrack(promotion)
      const result = transitionTabPromotion(previous, event)

      if (result.state === previous) return false
      setPromotion(result.state)
      result.effects.forEach(runPromotionEffect)

      return true
    }

    // Commits a promotion event in one transition with the tab strip and route change `update` makes. Disposal waits
    // for the commit, so the outgoing screen never reads disposed tab memory.
    const commitPromotion = async (event: () => TabPromotionCommit, update?: () => void) => {
      const after: TabPromotionEffect[] = []

      await startTransition(() => {
        update?.()
        const previous = promotion()
        const result = transitionTabPromotion(previous, event())

        if (result.state === previous) return
        setPromotion(result.state)
        result.effects.forEach((effect) => {
          if (runsAfterCommit(effect)) {
            after.push(effect)

            return
          }

          runPromotionEffect(effect)
        })
      })
      after.forEach(runPromotionEffect)
    }

    const runPromotionEffect = (effect: TabPromotionEffect) => {
      if (effect.type === "composer.transfer") {
        if (promptLength(effect.composer.current()))
          effect.target.set(effect.composer.current(), effect.composer.cursor())

        return
      }

      if (effect.type === "composer.recover") {
        const original = memory.get<ComposerState>(tabKey(effect.draft), "prompt")

        if (!original || !promptLength(effect.composer.current())) return
        // Nothing was submitted: recover both inputs in the original draft.
        const restored = appendPrompt(original.current(), effect.composer.current())
        original.set(restored, promptLength(restored))

        return
      }

      if (effect.type === "tab.restore") {
        const index = store.findIndex((tab) => tabKey(tab) === effect.key)

        if (index === -1) return
        const route = currentRoute()
        setStore(
          produce((tabs) => {
            tabs[index] = effect.draft
          }),
        )

        if (recentKey() === effect.key) setRecentKey(tabKey(effect.draft))

        if (route.type === "session" && tabMatchesRoute(effect.session, route)) navigateTab(effect.draft)

        return
      }

      if (effect.type === "session.cleanup") {
        updateClosed((stack) => removeClosedTabs(stack, effect.session.server, [effect.session.sessionId]))
        memory.remove(effect.key)
        removeInfo(effect.key)
        removeRegions(effect.key)

        return
      }

      memory.remove(tabKey(effect.draft))
      removeDraftPersisted(effect.draft.draftID)
    }

    onCleanup(memory.dispose)
    onCleanup(() => dispatchPromotion({ type: "dispose" }))

    // A contributed server that is unlisted or whose plugin is down is still known: only its removal drops its tabs.
    const known = () =>
      new Set<string>([...servers.list.map(ServerConnection.key), ...pluginServers.entries().map((item) => item.key)])

    createEffect(() => {
      if (!ready() || !recentReady()) return
      const serversSet = known()
      const next = store.filter((tab) => serversSet.has(tab.server))
      dispatchPromotion({ type: "keep.servers", servers: serversSet })

      if (next.length !== store.length) {
        for (const tab of store) {
          if (!serversSet.has(tab.server)) {
            const key = tabKey(tab)
            memory.remove(key)
            removeInfo(key)
            removeRegions(key)
          }
        }

        setStore(() => next)
      }

      if (recent.key && !next.some((tab) => tabKey(tab) === recent.key)) setRecentKey(undefined)
      const keys = new Set(next.map(tabKey))

      const previewTab = preview.current()

      if (previewTab) keys.add(tabKey(previewTab))

      for (const key of Object.keys(info)) {
        if (!keys.has(key)) removeInfo(key)
      }

      if (!regionsReady()) return

      for (const key of Object.keys(regions)) {
        if (!keys.has(key)) removeRegions(key)
      }
    })

    createEffect(() => {
      if (!closedReady()) return
      const serversSet = known()
      const next = closed.filter((entry) => serversSet.has(entry.tab.server))

      if (next.length !== closed.length) setClosed(() => next)
    })

    const navigateTab = (tab: Tab) => {
      if (preview.current()) {
        void startTransition(() => {
          preview.clear()
          setRecentKey(tabKey(tab))
          navigate(tabHref(tab))
        })

        return
      }

      const href = tabHref(tab)
      setRecentKey(tabKey(tab))
      navigate(href)
    }

    const disposeTab = (tab: Tab) => {
      const key = tabKey(tab)

      memory.remove(key)
      removeInfo(key)
      removeRegions(key)

      if (tab.type === "draft") removeDraftPersisted(tab.draftID)
    }

    const preview = createSessionPreview({
      tabs: () => store,
      onKeep: (tab): SessionTab => actions.addSessionTab(tab),
      onNavigate: (tab, isPreview) => {
        if (isPreview) {
          navigate(tabHref(tab))

          return
        }

        navigateTab(tab)
      },
      onDiscard: disposeTab,
    })

    const previewRoute = () => {
      const current = preview.current()

      const route = currentRoute()

      return (
        !!current &&
        route.type === "session" &&
        current.server === route.server &&
        (current.sessionId === route.sessionId || current.routeSessionId === route.sessionId)
      )
    }

    // `abandon` names pending sessions that go with the tab for good, rather than staying revisitable after a close.
    const removeTab = (index: number, abandon: readonly string[] = []) => {
      const tab = store[index]

      if (!tab) return

      // Closing the tab the route shows always moves the route, so nothing re-adds the tab for it.
      const nextTab = nextTabAfterClose(store, index, !previewRoute() && tabMatchesRoute(tab, currentRoute()))

      void commitPromotion(
        () => ({ type: "abandon", keys: abandon }),
        () => {
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
        },
      )
      disposeTab(tab)
    }

    const actions = {
      preview: preview.current,
      previewSession(tab: Omit<SessionTab, "type">) {
        void startTransition(() => preview.open(tab))
      },
      keepPreview(tab?: SessionTab) {
        void startTransition(() => preview.keep(tab))
      },
      closePreview() {
        if (!preview.current()) return
        void startTransition(() => {
          preview.clear()
          const next = store.find((tab) => tabKey(tab) === recentKey()) ?? store.at(-1)

          if (next) {
            navigateTab(next)

            return
          }

          navigate("/")
        })
      },
      sessionTab(server: ServerConnection.Key, sessionID: string) {
        const current = preview.current()

        return (
          findSessionTab(store, server, sessionID) ??
          (current ? findSessionTab([current], server, sessionID) : undefined)
        )
      },
      addSessionTab: (tab: Omit<SessionTab, "type">) => {
        const next = { type: "session" as const, ...tab }

        const current = preview.current()

        const existing = store.find(
          (item): item is SessionTab => item.type === "session" && tabKey(item) === tabKey(next),
        )

        if (existing) {
          if (current?.server === next.server && current.sessionId === next.sessionId) preview.release()

          return existing
        }

        void startTransition(() => {
          if (current?.server === next.server && current.sessionId === next.sessionId) preview.release()
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
            const next = keys.flatMap((key) => byKey.get(key) ?? [])

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
      /** Opens a draft tab; pass `draftID` to know it before the draft opens. */
      async newDraft(
        draft: Omit<DraftTab, "type" | "draftID"> & { draftID?: string },
        prompt?: string,
        model?: PromptModel,
      ) {
        const draftID = draft.draftID ?? uuid()
        const tab = { ...draft, type: "draft" as const, draftID }
        memory.ensure(tabKey(tab), "prompt", () => createDraftComposerState(draftID, { prompt, model }))
        await startTransition(() => {
          preview.clear()
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
      pendingSession(server: ServerConnection.Key, sessionID: string): PendingSession | undefined {
        return pendingPromotion(promotion(), tabKey({ type: "session", server, sessionId: sessionID }))
      },
      prepareSession(
        draftID: string,
        session: Omit<SessionTab, "type">,
        preview: Omit<PendingSession, "draft" | "composer">,
      ) {
        // Snapshot the draft before replacing its store entry; keep its composer alive for rollback.
        const draft = { ...actions.draft(draftID) }
        const next = { type: "session" as const, ...session }
        const key = tabKey(next)
        const composer = createMemoryComposerState()
        let attempt = 0

        const ready = startTransition(() => {
          dispatchPromotion({ type: "prepare", key, session: next, pending: { draft, ...preview, composer } })
          const state = promotion()
          attempt = state.status === "active" ? state.attempt : 0
          const index = store.findIndex((tab) => tab.type === "draft" && tab.draftID === draftID)

          if (index === -1) {
            void commitPromotion(() => ({ type: "abandon", keys: [key] }))

            return
          }

          const active = location.pathname === "/new-session" && location.query.draftId === draftID
          setStore(
            produce((tabs) => {
              tabs[index] = next
            }),
          )

          if (recentKey() === tabKey(draft)) setRecentKey(key)

          if (active) navigateTab(next)
        })

        return {
          ready,
          async complete(target: ComposerTarget) {
            await ready

            if (!dispatchPromotion({ type: "complete.start", key, attempt, target })) return
            await memory.get<ComposerState>(key, "prompt")?.ready.promise
            await commitPromotion(() => ({ type: "complete.settled", key, attempt }))
          },
          async rollback(worktree?: string) {
            await ready

            if (!dispatchPromotion({ type: "rollback.start", key, attempt, worktree })) return
            await commitPromotion(() => ({
              type: "rollback.settled",
              key,
              attempt,
              open: store.some((tab) => tabKey(tab) === key),
            }))
          },
        }
      },
      removeTab: (index: number) => removeTab(index),
      // User-initiated close: records the tab so it can be reopened.
      // Cleanup paths (missing sessions, archive, server removal) go through
      // removeTab and friends directly and are not recorded.
      closeTab(index: number) {
        const tab = store[index]

        if (!tab) return

        if (tab.type === "session") updateClosed((stack) => pushClosedTab(stack, tab, index, info[tabKey(tab)]))
        removeTab(index)
      },
      closeTabs(keys: string[], keep: Tab) {
        const removed = new Set(keys)

        const entries = store.flatMap((tab, index) => (removed.has(tabKey(tab)) ? [{ tab, index }] : []))

        // Recording right-to-left lets successive reopens restore the original positions.
        updateClosed((stack) =>
          entries
            .toReversed()
            .reduce((stack, entry) => pushClosedTab(stack, entry.tab, entry.index, info[tabKey(entry.tab)]), stack),
        )

        const route = currentRoute()
        const shown = !previewRoute() && entries.some((entry) => tabMatchesRoute(entry.tab, route))
        const remembered = recentKey()

        void startTransition(() => {
          setStore((tabs) => tabs.filter((tab) => !removed.has(tabKey(tab))))

          if (shown) {
            navigateTab(keep)

            return
          }

          if (remembered && removed.has(remembered)) setRecentKey(tabKey(keep))
        })
        entries.forEach((entry) => disposeTab(entry.tab))
      },
      reopenClosedTab(target?: SessionTab, options?: { append?: boolean }) {
        dispatchHydration({ type: "closed.op", op: { kind: "reopen", target, options } })
      },
      removeSessionTab(input: Omit<SessionTab, "type">) {
        const current = preview.current()

        if (
          current?.server === input.server &&
          (current.sessionId === input.sessionId || current.routeSessionId === input.sessionId)
        )
          actions.closePreview()
        updateClosed((stack) => removeClosedTabs(stack, input.server, [input.sessionId]))
        const abandon = [tabKey({ type: "session", ...input })]

        const index = store.findIndex(
          (tab) =>
            tab.type === "session" &&
            tab.server === input.server &&
            (tab.sessionId === input.sessionId || tab.routeSessionId === input.sessionId),
        )

        if (index !== -1) {
          removeTab(index, abandon)

          return
        }

        void commitPromotion(() => ({ type: "abandon", keys: abandon }))
      },
      removeServer(key: ServerConnection.Key) {
        updateClosed((stack) => stack.filter((entry) => entry.tab.server !== key))
        dispatchPromotion({ type: "abandon.server", server: key })
        const drafts = store.flatMap((tab) => (tab.type === "draft" && tab.server === key ? [tab.draftID] : []))
        const removed = store.filter((tab) => tab.server === key).map(tabKey)
        setStore((tabs) => tabs.filter((tab) => tab.server !== key))

        if (preview.current()?.server === key) actions.closePreview()

        for (const key of removed) memory.remove(key)

        for (const key of removed) removeInfo(key)

        if (removed.some((key) => key === recentKey())) setRecentKey(undefined)

        for (const draftID of drafts) removeDraftPersisted(draftID)
      },
      removeSessions: (input: SessionTabsRemovedDetail) => {
        const targetServer = input.server

        const current = preview.current()

        if (current?.server === targetServer && input.sessionIDs.includes(current.sessionId)) actions.closePreview()
        updateClosed((stack) => removeClosedTabs(stack, targetServer, input.sessionIDs))

        const removed = store
          .filter(
            (tab) => tab.type === "session" && tab.server === targetServer && input.sessionIDs.includes(tab.sessionId),
          )
          .map(tabKey)

        const abandon = input.sessionIDs.map((sessionId) =>
          tabKey({ type: "session", server: targetServer, sessionId }),
        )

        void commitPromotion(
          () => ({ type: "abandon", keys: abandon }),
          () => {
            setStore(
              produce((tabs) => {
                const sessionIDs = new Set(input.sessionIDs)
                const route = currentRoute()

                const currentIndex =
                  route.type === "session" ? tabs.findIndex((tab) => tabMatchesRoute(tab, route)) : -1

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

            if (removed.some((key) => key === recentKey())) setRecentKey(undefined)
          },
        )

        for (const key of removed) memory.remove(key)

        for (const key of removed) removeInfo(key)
      },
      rememberSessionInfo(tab: SessionTab, session: SessionInfo, prompted: boolean) {
        const key = tabKey(tab)
        const current = info[key]

        const next = {
          title: session.title,
          directory: session.location.directory,
          prompted: current?.prompted === true || prompted,
        }

        if (
          current &&
          current.title === next.title &&
          current.directory === next.directory &&
          current.prompted === next.prompted
        )
          return
        console.debug("[tabs] update persisted session info", { key, sessionID: session.id, current, next })
        setInfo(key, next)
      },
      select: navigateTab,
      remember(tab: Tab) {
        preview.activate(tab)
        const key = tabKey(tab)

        if (recentKey() !== key) setRecentKey(key)
      },
      rememberSessionRoute(tab: SessionTab, sessionId: string, parentId?: string) {
        const index = store.findIndex((item) => tabKey(item) === tabKey(tab))

        if (index === -1) {
          if (preview.current() === tab) preview.setRoute(sessionId, parentId)

          return
        }

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
          const current = preview.current()

          if (current) {
            navigate(tabHref(current))

            return
          }

          const tab = store.find((tab) => tabKey(tab) === recentKey())

          if (tab) navigateTab(tab)

          return
        }

        if (input.current) {
          if (input.current !== preview.current()) setRecentKey(tabKey(input.current))
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
      region(tab: Tab | undefined, region: TabRegion, fallback = false) {
        if (!tab) return fallback

        return regions[tabKey(tab)]?.[region] ?? fallback
      },
      setRegion(tab: Tab | undefined, region: TabRegion, opened: boolean) {
        if (!tab) return
        const key = tabKey(tab)
        const current = regions[key]

        if (current?.[region] === opened) return

        if (!current) {
          setRegions(key, { [region]: opened })

          return
        }

        setRegions(key, region, opened)
      },
      regionSize(tab: Tab | undefined, size: TabRegionSize) {
        if (!tab) return

        return regions[tabKey(tab)]?.[size]
      },
      setRegionSize(tab: Tab | undefined, size: TabRegionSize, value: number) {
        if (!tab) return
        const key = tabKey(tab)
        const current = regions[key]

        if (current?.[size] === value) return

        if (!current) {
          setRegions(key, { [size]: value })

          return
        }

        setRegions(key, size, value)
      },
    }

    return { ...actions, store, info, closed, ready, infoReady, recentReady, recentKey, closedReady, regionsReady }
  },
})
