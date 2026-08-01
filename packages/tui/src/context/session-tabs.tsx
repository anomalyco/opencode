import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { isDeepEqual } from "remeda"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useData } from "./data"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useConfig } from "../config"
import { useStorage } from "./storage"
import { useTuiPaths } from "./runtime"
import {
  closeSessionTab,
  cycleSessionTab,
  moveSessionTab,
  moveSessionTabHistory,
  NEW_SESSION_TAB_TITLE,
  openSessionTab,
  orderSessionTabs,
  recordClosedSessionTab,
  recordSessionTabHistory,
  reopenSessionTab,
  type ClosedSessionTab,
  type SessionTab,
  type SessionTabHistory,
  type SessionTabUnread,
} from "./session-tabs-model"

type TabsState = {
  tabs: SessionTab[]
  unread: Record<string, SessionTabUnread>
}

type PersistedState = {
  global: TabsState
  cwd: Record<string, TabsState>
}

const empty = (): TabsState => ({ tabs: [], unread: {} })

// Deliberately after connect settles: the visible session's mount syncs win the first slots.
const TAB_PREFETCH_DELAY = 300

export const { use: useSessionTabs, provider: SessionTabsProvider } = createSimpleContext({
  name: "SessionTabs",
  init: () => {
    const route = useRoute()
    const client = useClient()
    const data = useData()
    const event = useEvent()
    const config = useConfig().data
    const paths = useTuiPaths()
    const enabled = () => config.tabs?.enabled ?? false
    // Keyed reconcile keeps tab object identity across reorders, so strip rows move instead of
    // mutating in place, which per-row animations and drag state depend on.
    const [store, updateStore] = useStorage().store<PersistedState>("tabs", {
      initial: {
        global: empty(),
        cwd: {},
      },
      key: "sessionID",
    })
    const fallback = empty()
    const [promptPulses, setPromptPulses] = createSignal<Record<string, number>>({})
    const [lastActivity, setLastActivity] = createSignal<Record<string, number>>({})
    const [navigationActive, setNavigationActive] = createSignal(false)
    const [navigationSelection, setNavigationSelection] = createSignal<string>()
    const [navigationPendingDone, setNavigationPendingDone] = createSignal<string>()
    let history: SessionTabHistory = { entries: [], index: -1 }
    // User-closed tabs eligible for reopening; in-memory like history, deleted sessions pruned.
    let closedTabs: ClosedSessionTab[] = []

    function state() {
      if (config.tabs?.scope === "cwd") return store.cwd[paths.cwd] ?? fallback
      return store.global
    }

    function update(mutation: (draft: TabsState) => void) {
      const scope = config.tabs?.scope ?? "global"
      void updateStore((draft) => mutation(scope === "cwd" ? (draft.cwd[paths.cwd] ??= empty()) : draft.global)).catch(
        // Failed writes lose only tab layout, but silence would hide tabs resetting every launch.
        (error) => console.error("Failed to persist session tabs", error),
      )
    }

    const root = (sessionID: string) => data.session.root(sessionID)
    const updated = (sessionID: string) => {
      const session = root(sessionID)
      const members = data.session.family(session)
      return (members.length > 0 ? members : [session]).reduce(
        (latest, id) =>
          Math.max(
            latest,
            data.session.get(id)?.time.updated ?? 0,
            lastActivity()[id] ?? 0,
          ),
        0,
      )
    }
    const touch = (sessionID: string, created: number) => {
      if (!enabled()) return
      if ((lastActivity()[sessionID] ?? 0) >= created) return
      setLastActivity((value) => ({ ...value, [sessionID]: Math.max(value[sessionID] ?? 0, created) }))
    }
    const title = (sessionID: string, persisted?: string, fallback?: string) => {
      const session = data.session.get(sessionID)
      return session?.title ?? persisted ?? fallback ?? (session ? withTimestampedFallback(session) : undefined)
    }
    const normalize = (value: TabsState): TabsState => ({
      tabs: value.tabs.reduce<SessionTab[]>((tabs, tab) => {
        const sessionID = root(tab.sessionID)
        return openSessionTab(tabs, { sessionID, title: title(sessionID, tab.title) })
      }, []),
      unread: Object.entries(value.unread).reduce<Record<string, SessionTabUnread>>((result, entry) => {
        const sessionID = root(entry[0])
        result[sessionID] = result[sessionID] === "error" ? "error" : entry[1]
        return result
      }, {}),
    })
    const current = () => (route.data.type === "session" ? root(route.data.sessionID) : undefined)
    const newTab = createMemo((open = false) => {
      if (route.data.type === "home") return true
      if (!open) return false
      const sessionID = current()
      return sessionID !== undefined && !state().tabs.some((tab) => tab.sessionID === sessionID)
    }, false)
    const status = (sessionID: string) => {
      const session = root(sessionID)
      const members = data.session.family(session)
      const family = members.length > 0 ? members : [session]
      return {
        unread: state().unread[session],
        promptPulse: promptPulses()[session] ?? 0,
        attention: family.some(
          (id) => (data.session.permission.list(id)?.length ?? 0) > 0 || (data.session.form.list(id)?.length ?? 0) > 0,
        ),
        busy: family.some((id) => data.session.status(id) === "running" || data.session.pending.list(id).length > 0),
      }
    }
    const recent = () =>
      orderSessionTabs(state().tabs, (sessionID) => ({
        busy: status(sessionID).busy,
        updated: updated(sessionID),
      }))

    function markUnread(sessionID: string, unread: SessionTabUnread) {
      if (!enabled()) return
      const session = root(sessionID)
      if (current() === session || !state().tabs.some((tab) => tab.sessionID === session)) return
      if (state().unread[session] === unread) return
      update((draft) => {
        if (!draft.tabs.some((tab) => tab.sessionID === session)) return
        draft.unread[session] = unread
      })
    }

    createEffect(() => {
      if (!enabled()) return
      if (route.data.type !== "session" || route.data.sessionID === "dummy") return
      const sessionID = root(route.data.sessionID)
      history = recordSessionTabHistory(history, sessionID)
      const fallback = newTab() ? NEW_SESSION_TAB_TITLE : undefined
      const tabs = openSessionTab(state().tabs, {
        sessionID,
        title: title(sessionID, state().tabs.find((tab) => tab.sessionID === sessionID)?.title, fallback),
      })
      if (tabs === state().tabs && !state().unread[sessionID]) return
      update((draft) => {
        draft.tabs = openSessionTab(draft.tabs, {
          sessionID,
          title: title(sessionID, draft.tabs.find((tab) => tab.sessionID === sessionID)?.title, fallback),
        })
        delete draft.unread[sessionID]
      })
    })

    createEffect(() => {
      if (!navigationActive()) return
      const tabs = state().tabs
      if (tabs.length === 0) {
        setNavigationActive(false)
        setNavigationSelection(undefined)
        setNavigationPendingDone(undefined)
        return
      }
      if (tabs.some((tab) => tab.sessionID === navigationSelection())) return
      setNavigationSelection(current() ?? recent()[0]?.sessionID)
      setNavigationPendingDone(undefined)
    })

    createEffect(() => {
      if (!enabled()) return
      const next = normalize(state())
      if (isDeepEqual(next, state())) return
      update((draft) => {
        const next = normalize(draft)
        draft.tabs = next.tabs
        draft.unread = next.unread
      })
    })

    // Warm open tabs' session data so first switches render from cache instead of fetching inside
    // the switch gesture. Uses only existing sync methods (each dedupes internally), so reruns on
    // tab-set or connection changes are no-ops for already-warm sessions, and reconnects double as
    // a cache refresh after an SSE gap. The delay lets the current session's own mount syncs get
    // the first connection slots. The effect tracks only the id set: reorders, tab switches, and
    // title updates neither restart the timer nor an in-flight warm pass; the timer callback
    // itself runs untracked, where the current session is skipped.
    const openTabSessions = createMemo(() =>
      state()
        .tabs.map((tab) => tab.sessionID)
        .sort()
        .join("\n"),
    )
    createEffect(() => {
      if (!enabled()) return
      if (client.connection.status() !== "connected") return
      if (openTabSessions() === "") return
      let stale = false
      const timer = setTimeout(async () => {
        const sessions = state()
          .tabs.map((tab) => tab.sessionID)
          .filter((sessionID) => sessionID !== current())
        for (const sessionID of sessions) {
          if (stale) return
          await Promise.allSettled([
            data.session.sync(sessionID, { children: true }),
            data.session.message.sync(sessionID),
            data.session.pending.sync(sessionID),
            data.session.permission.sync(sessionID),
            data.session.form.sync(sessionID),
          ])
        }
      }, TAB_PREFETCH_DELAY)
      onCleanup(() => {
        stale = true
        clearTimeout(timer)
      })
    })

    onCleanup(
      event.on("session.execution.succeeded", (evt) => {
        touch(evt.data.sessionID, evt.created)
        markUnread(evt.data.sessionID, "activity")
      }),
    )
    onCleanup(
      event.on("session.execution.interrupted", (evt) => {
        touch(evt.data.sessionID, evt.created)
        markUnread(evt.data.sessionID, "activity")
      }),
    )
    onCleanup(
      event.on("session.execution.failed", (evt) => {
        touch(evt.data.sessionID, evt.created)
        markUnread(evt.data.sessionID, "error")
      }),
    )
    onCleanup(
      event.on("session.input.admitted", (evt) => {
        if (!enabled() || evt.data.input.type !== "user") return
        touch(evt.data.sessionID, evt.created)
        const sessionID = root(evt.data.sessionID)
        if (current() === sessionID || !state().tabs.some((tab) => tab.sessionID === sessionID)) return
        setPromptPulses((pulses) => ({ ...pulses, [sessionID]: (pulses[sessionID] ?? 0) + 1 }))
      }),
    )
    onCleanup(
      event.on("session.error", (evt) => {
        if (evt.data.sessionID) markUnread(evt.data.sessionID, "error")
      }),
    )
    onCleanup(
      event.on("session.deleted", (evt) => {
        const target = root(evt.data.sessionID)
        closedTabs = closedTabs.filter((entry) => entry.tab.sessionID !== target)
        remove(evt.data.sessionID, enabled())
      }),
    )

    function remove(sessionID: string, navigate: boolean) {
      const target = root(sessionID)
      const closed = closeSessionTab(state().tabs, target)
      if (closed.tabs === state().tabs) return
      const selected = navigate && current() === target
      const previous = selected
        ? moveSessionTabHistory(recordSessionTabHistory(history, target), closed.tabs, target, -1)
        : { history, sessionID: undefined }
      const next = previous.sessionID ?? closed.next
      history = previous.history
      update((draft) => {
        draft.tabs = closeSessionTab(draft.tabs, target).tabs
        delete draft.unread[target]
      })
      setPromptPulses((pulses) => {
        if (pulses[target] === undefined) return pulses
        const next = { ...pulses }
        delete next[target]
        return next
      })
      setLastActivity((activity) => {
        const family = data.session.family(target)
        const members = family.length > 0 ? family : [target]
        if (!members.some((id) => activity[id] !== undefined)) return activity
        const next = { ...activity }
        for (const id of members) delete next[id]
        return next
      })
      if (selected) route.navigate(next ? { type: "session", sessionID: next } : { type: "home" })
    }

    return {
      enabled,
      tabs() {
        return state().tabs
      },
      recent,
      updated,
      newTab() {
        return newTab()
      },
      current,
      status,
      select(sessionID: string) {
        if (!enabled()) return
        route.navigate({ type: "session", sessionID: root(sessionID) })
      },
      close(sessionID?: string) {
        if (!enabled()) return
        const target = sessionID ? root(sessionID) : current()
        if (!target) {
          const previous = moveSessionTabHistory(history, state().tabs, undefined, -1)
          history = previous.history
          const session = previous.sessionID ?? state().tabs.at(-1)?.sessionID
          if (route.data.type === "home" && session) route.navigate({ type: "session", sessionID: session })
          return
        }
        const index = state().tabs.findIndex((tab) => tab.sessionID === target)
        const tab = state().tabs[index]
        if (tab) closedTabs = recordClosedSessionTab(closedTabs, tab, index)
        remove(target, true)
      },
      reopen() {
        if (!enabled()) return
        const result = reopenSessionTab(closedTabs, state().tabs)
        closedTabs = result.stack
        const tabs = result.tabs
        if (!tabs || !result.sessionID) return
        update((draft) => {
          draft.tabs = tabs
        })
        route.navigate({ type: "session", sessionID: result.sessionID })
      },
      move(sessionID: string, index: number) {
        if (!enabled()) return
        const session = root(sessionID)
        if (moveSessionTab(state().tabs, session, index) === state().tabs) return
        update((draft) => {
          draft.tabs = moveSessionTab(draft.tabs, session, index)
        })
      },
      cycle(direction: 1 | -1, order: "tabs" | "recent" = "tabs") {
        if (!enabled()) return
        const tab = cycleSessionTab(order === "recent" ? recent() : state().tabs, current(), direction)
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      cycleUnread(direction: 1 | -1, order: "tabs" | "recent" = "tabs") {
        if (!enabled()) return
        const tab = cycleSessionTab(
          (order === "recent" ? recent() : state().tabs).filter(
            (tab) => state().unread[tab.sessionID] || status(tab.sessionID).attention,
          ),
          current(),
          direction,
        )
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      selectIndex(index: number, order: "tabs" | "recent" = "tabs") {
        if (!enabled()) return
        const tab = (order === "recent" ? recent() : state().tabs)[index]
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      navigation: {
        active: navigationActive,
        selected: navigationSelection,
        pendingDone: navigationPendingDone,
        focus() {
          if (!enabled() || state().tabs.length === 0) return false
          setNavigationSelection(current() ?? recent()[0]?.sessionID)
          setNavigationPendingDone(undefined)
          setNavigationActive(true)
          return true
        },
        blur() {
          setNavigationActive(false)
          setNavigationPendingDone(undefined)
        },
        move(direction: 1 | -1) {
          const tabs = recent().map((tab) => tab.sessionID)
          if (!navigationActive() || tabs.length === 0) return
          const index = tabs.findIndex((sessionID) => sessionID === navigationSelection())
          const start = index === -1 ? (direction === 1 ? -1 : 0) : index
          setNavigationSelection(tabs[(start + direction + tabs.length) % tabs.length])
          setNavigationPendingDone(undefined)
        },
        select() {
          const sessionID = navigationSelection()
          if (!navigationActive() || !sessionID) return
          setNavigationActive(false)
          setNavigationPendingDone(undefined)
          route.navigate({ type: "session", sessionID })
        },
        done() {
          const sessionID = navigationSelection()
          if (!navigationActive() || !sessionID) return
          if (navigationPendingDone() !== sessionID) {
            setNavigationPendingDone(sessionID)
            return
          }
          const tabs = recent().map((tab) => tab.sessionID)
          const index = tabs.indexOf(sessionID)
          const next = tabs[index + 1] ?? tabs[index - 1]
          const selected = current() === sessionID
          setNavigationPendingDone(undefined)
          remove(sessionID, true)
          setNavigationSelection(selected ? (current() ?? next) : next)
          if (!next) setNavigationActive(false)
        },
      },
    }
  },
})
