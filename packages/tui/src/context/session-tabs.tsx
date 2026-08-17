import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { isDeepEqual } from "remeda"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { locationKey, useData } from "./data"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useConfig } from "../config"
import { useLocation } from "./location"
import { useStorage } from "./storage"
import { useTuiPaths } from "./runtime"
import { newSessionLocation } from "../config/new-session-location"
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

type ScrollAnchor = {
  messageID: string
  screenY: number
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
    const location = useLocation()
    const paths = useTuiPaths()
    const renderer = useRenderer()
    const enabled = () => config.tabs.enabled
    // Focus reporting emits transitions, so an interactive launch owns unread state until its first blur.
    const [focused, setFocused] = createSignal(true)
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
    const closing = new Set<string>()
    // User-closed tabs eligible for reopening; in-memory like history, deleted sessions pruned.
    let closedTabs: ClosedSessionTab[] = []
    const scrollAnchors = new Map<string, ScrollAnchor>()

    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)
    onCleanup(() => {
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
    })

    createEffect(() => {
      if (config.experimental?.tab_scroll === true) return
      scrollAnchors.clear()
    })

    function state() {
      if (config.tabs.scope === "cwd") return store.cwd[paths.cwd] ?? fallback
      return store.global
    }

    function update(mutation: (draft: TabsState) => void) {
      const scope = config.tabs.scope
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
        if (tab.groupID) return openSessionTab(tabs, { ...tab, sessionID: tab.groupID })
        const sessionID = root(tab.sessionID)
        return openSessionTab(tabs, { sessionID, title: title(sessionID, tab.title) })
      }, []),
      unread: Object.entries(value.unread).reduce<Record<string, SessionTabUnread>>((result, entry) => {
        const sessionID = root(entry[0])
        result[sessionID] = result[sessionID] === "error" ? "error" : entry[1]
        return result
      }, {}),
    })
    const current = () => {
      if (route.data.type === "session") return root(route.data.sessionID)
      if (route.data.type === "workspace") return route.data.groupID
      return undefined
    }
    const newTab = createMemo((open = false) => {
      if (route.data.type === "home") return true
      if (!open) return false
      const sessionID = current()
      return sessionID !== undefined && !state().tabs.some((tab) => tab.sessionID === sessionID)
    }, false)
    const status = (sessionID: string) => {
      if (state().tabs.some((tab) => tab.sessionID === sessionID && tab.groupID)) {
        return { unread: undefined, promptPulse: 0, attention: false, busy: false }
      }
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
      if (!enabled() || !focused()) return
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
      if (route.data.type === "workspace") {
        history = recordSessionTabHistory(history, route.data.groupID)
        return
      }
      if (route.data.type !== "session" || route.data.sessionID === "dummy") return
      const sessionID = root(route.data.sessionID)
      history = recordSessionTabHistory(history, sessionID)
      const fallback = newTab() ? NEW_SESSION_TAB_TITLE : undefined
      const tabs = openSessionTab(state().tabs, {
        sessionID,
        title: title(sessionID, state().tabs.find((tab) => tab.sessionID === sessionID)?.title, fallback),
      })
      if (tabs === state().tabs) return
      update((draft) => {
        draft.tabs = openSessionTab(draft.tabs, {
          sessionID,
          title: title(sessionID, draft.tabs.find((tab) => tab.sessionID === sessionID)?.title, fallback),
        })
      })
    })

    createEffect(() => {
      if (!enabled() || !focused()) return
      if (route.data.type !== "session" || route.data.sessionID === "dummy") return
      const sessionID = root(route.data.sessionID)
      if (!state().unread[sessionID]) return
      update((draft) => {
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

    // Load lightweight session and location metadata concurrently so persisted tabs can resolve
    // their project and branch labels. Delay the heavier per-tab data so the visible session keeps
    // the first connection slots and switches still render from a warm cache.
    const openTabSessions = createMemo(() =>
      state()
        .tabs.filter((tab) => !tab.groupID)
        .map((tab) => tab.sessionID)
        .sort()
        .join("\n"),
    )
    createEffect(() => {
      if (!enabled()) return
      if (client.connection.status() !== "connected") return
      const signature = openTabSessions()
      if (signature === "") return
      const sessionIDs = signature.split("\n")
      let stale = false
      void (async () => {
        await Promise.allSettled(sessionIDs.map((sessionID) => data.session.sync(sessionID)))
        if (stale) return
        const locations = new Map(
          sessionIDs
            .map((sessionID) => data.session.get(sessionID)?.location)
            .filter((location) => location !== undefined)
            .map((location) => [locationKey(location), location]),
        )
        await Promise.allSettled(
          Array.from(locations.values(), (location) =>
            Promise.all([data.location.syncInfo(location), data.location.vcs.sync(location)]),
          ),
        )
      })()
      const timer = setTimeout(async () => {
        const sessions = state()
          .tabs.filter((tab) => !tab.groupID)
          .map((tab) => tab.sessionID)
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
      event.on("session.moved", (evt) => {
        if (!enabled() || !state().tabs.some((tab) => tab.sessionID === root(evt.data.sessionID))) return
        void Promise.allSettled([data.location.syncInfo(evt.data.location), data.location.vcs.sync(evt.data.location)])
      }),
    )
    onCleanup(
      event.on("session.inbox.enqueued", (evt) => {
        if (!enabled() || evt.data.item.type !== "user") return
        const sessionID = root(evt.data.sessionID)
        if (current() === sessionID || !state().tabs.some((tab) => tab.sessionID === sessionID)) return
        setPromptPulses((pulses) => ({ ...pulses, [sessionID]: (pulses[sessionID] ?? 0) + 1 }))
      }),
    )
    onCleanup(
      event.on("session.deleted", (evt) => {
        const target = root(evt.data.sessionID)
        closedTabs = closedTabs.filter((entry) => entry.tab.groupID || entry.tab.sessionID !== target)
        remove(evt.data.sessionID, enabled())
      }),
    )

    onCleanup(
      event.on("group.item.removed", (evt) => {
        if (closing.has(evt.data.groupID)) return
        if (!state().tabs.some((tab) => tab.groupID === evt.data.groupID)) return
        void client.api["server.persistentPty"].group
          .get({ groupID: evt.data.groupID })
          .then(async (group) => {
            if (group.items.length > 0) return
            await client.api["server.persistentPty"].group.remove({ groupID: group.id })
            remove(group.id, enabled())
          })
          .catch(() => undefined)
      }),
    )

    function tab(id: string) {
      return state().tabs.find((item) => item.sessionID === id)
    }

    function navigate(id: string | undefined) {
      if (!id) {
        route.navigate({ type: "home" })
        return
      }
      const target = tab(id)
      if (target?.groupID) {
        route.navigate({ type: "workspace", groupID: target.groupID })
        return
      }
      route.navigate({ type: "session", sessionID: id })
    }

    function remove(sessionID: string, shouldNavigate: boolean) {
      const target = tab(sessionID)?.groupID ? sessionID : root(sessionID)
      scrollAnchors.delete(target)
      const closed = closeSessionTab(state().tabs, target)
      const selected = shouldNavigate && current() === target
      if (closed.tabs === state().tabs && !selected) return
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
      if (selected) navigate(next)
    }

    async function closeWorkspace(tab: SessionTab) {
      if (!tab.groupID || closing.has(tab.groupID)) return
      closing.add(tab.groupID)
      try {
        const api = client.api["server.persistentPty"]
        const group = await api.group.get({ groupID: tab.groupID })
        if (!group.items.some((item) => item.type === "session")) {
          for (const terminal of await api.list({ groupID: group.id })) await api.remove({ ptyID: terminal.id })
          await api.group.remove({ groupID: group.id })
        }
        remove(tab.sessionID, true)
      } catch (error) {
        console.error("Failed to close terminal workspace", error)
      } finally {
        closing.delete(tab.groupID)
      }
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
      scrollAnchor(sessionID: string) {
        const target = root(sessionID)
        if (!state().tabs.some((tab) => tab.sessionID === target)) return
        return scrollAnchors.get(target)
      },
      setScrollAnchor(sessionID: string, anchor: ScrollAnchor | undefined) {
        const target = root(sessionID)
        if (anchor === undefined || !state().tabs.some((tab) => tab.sessionID === target)) {
          scrollAnchors.delete(target)
          return
        }
        const current = scrollAnchors.get(target)
        if (current?.messageID === anchor.messageID && current.screenY === anchor.screenY) return
        scrollAnchors.set(target, anchor)
      },
      select(sessionID: string) {
        if (!enabled()) return
        const target = tab(sessionID)
        if (target?.groupID) {
          route.navigate({ type: "workspace", groupID: target.groupID })
          return
        }
        route.navigate({ type: "session", sessionID: root(sessionID) })
      },
      openWorkspace(groupID: string, directory: string) {
        if (!enabled()) return
        update((draft) => {
          draft.tabs = openSessionTab(draft.tabs, {
            sessionID: groupID,
            groupID,
            directory,
            title: "Terminal",
          })
        })
        route.navigate({ type: "workspace", groupID })
      },
      add() {
        if (!enabled()) return
        const sessionID = current()
        const currentLocation = (sessionID ? data.session.get(sessionID)?.location : undefined) ?? location.ref
        route.navigate({
          type: "home",
          location: newSessionLocation(
            config.session.new_location,
            paths.cwd,
            currentLocation,
            location.error?.location,
          ),
        })
      },
      close(sessionID?: string) {
        if (!enabled()) return
        const target = sessionID ? (tab(sessionID)?.groupID ? sessionID : root(sessionID)) : current()
        if (!target) {
          const previous = moveSessionTabHistory(history, state().tabs, undefined, -1)
          history = previous.history
          const session = previous.sessionID ?? state().tabs.at(-1)?.sessionID
          if (route.data.type === "home" && session) navigate(session)
          return
        }
        const index = state().tabs.findIndex((tab) => tab.sessionID === target)
        const selected = state().tabs[index]
        if (selected?.groupID) {
          void closeWorkspace(selected)
          return
        }
        if (selected) closedTabs = recordClosedSessionTab(closedTabs, selected, index)
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
        const session = tab(sessionID)?.groupID ? sessionID : root(sessionID)
        if (moveSessionTab(state().tabs, session, index) === state().tabs) return
        update((draft) => {
          draft.tabs = moveSessionTab(draft.tabs, session, index)
        })
      },
      cycle(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(state().tabs, current(), direction)
        if (tab) navigate(tab.sessionID)
      },
      cycleUnread(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(state().tabs, current(), direction, (tab) =>
          Boolean(state().unread[tab.sessionID] || status(tab.sessionID).attention),
        )
        if (tab) navigate(tab.sessionID)
      },
      selectIndex(index: number) {
        if (!enabled()) return
        const tab = state().tabs[index]
        if (tab) navigate(tab.sessionID)
      },
    }
  },
})
