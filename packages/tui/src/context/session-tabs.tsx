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
    const title = (sessionID: string, persisted?: string, fallback?: string) => {
      const session = data.session.get(sessionID)
      return session?.title ?? persisted ?? fallback ?? (session ? withTimestampedFallback(session) : undefined)
    }
    const normalize = (value: TabsState) => ({
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
      if (!enabled()) return
      const next = normalize(state())
      if (isDeepEqual(next, state())) return
      update((draft) => {
        const next = normalize(draft)
        draft.tabs = next.tabs
        draft.unread = next.unread
      })
    })

    // Load lightweight session metadata concurrently so persisted tabs can resolve their project
    // labels immediately. Delay the heavier per-tab data so the visible session keeps the first
    // connection slots and switches still render from a warm cache.
    const openTabSessions = createMemo(() =>
      state()
        .tabs.map((tab) => tab.sessionID)
        .sort()
        .join("\n"),
    )
    createEffect(() => {
      if (!enabled()) return
      if (client.connection.status() !== "connected") return
      const sessionIDs = openTabSessions()
      if (sessionIDs === "") return
      void Promise.allSettled(sessionIDs.split("\n").map((sessionID) => data.session.sync(sessionID)))
      let stale = false
      const timer = setTimeout(async () => {
        const sessions = state()
          .tabs.map((tab) => tab.sessionID)
          .filter((sessionID) => sessionID !== current())
        for (const sessionID of sessions) {
          if (stale) return
          await Promise.allSettled([
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

    onCleanup(event.on("session.execution.succeeded", (evt) => markUnread(evt.data.sessionID, "activity")))
    onCleanup(event.on("session.execution.interrupted", (evt) => markUnread(evt.data.sessionID, "activity")))
    onCleanup(event.on("session.execution.failed", (evt) => markUnread(evt.data.sessionID, "error")))
    onCleanup(
      event.on("session.input.admitted", (evt) => {
        if (!enabled() || evt.data.input.type !== "user") return
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
      if (selected) route.navigate(next ? { type: "session", sessionID: next } : { type: "home" })
    }

    return {
      enabled,
      tabs() {
        return state().tabs
      },
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
      cycle(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(state().tabs, current(), direction)
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      cycleUnread(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(state().tabs, current(), direction, (tab) =>
          Boolean(state().unread[tab.sessionID] || status(tab.sessionID).attention),
        )
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      selectIndex(index: number) {
        if (!enabled()) return
        const tab = state().tabs[index]
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
    }
  },
})
