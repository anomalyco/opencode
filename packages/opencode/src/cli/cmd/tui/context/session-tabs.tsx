import path from "path"
import { batch, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util"
import { createSimpleContext } from "./helper"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useSync } from "./sync"

type SessionTabsState = {
  ready: boolean
  pinned: string[]
  // Sessions visited during this TUI run that are not pinned. In-memory only —
  // cleared on restart so the next launch shows pinned + currently busy.
  visited: string[]
}

type SessionTabsFile = {
  byDirectory: Record<string, string[]>
}

export type VisibleTab = {
  id: string
  pinned: boolean
}

export const { use: useSessionTabs, provider: SessionTabsProvider } = createSimpleContext({
  name: "SessionTabs",
  init: () => {
    const sync = useSync()
    const route = useRoute()
    const event = useEvent()

    const filePath = path.join(Global.Path.state, "session-tabs.json")

    const [store, setStore] = createStore<SessionTabsState>({
      ready: false,
      pinned: [],
      visited: [],
    })

    const writeState = { pending: false, contents: { byDirectory: {} } as SessionTabsFile }

    function directoryKey() {
      return sync.path.directory
    }

    function persist() {
      if (!store.ready) {
        writeState.pending = true
        return
      }
      writeState.pending = false
      writeState.contents.byDirectory[directoryKey()] = [...store.pinned]
      void Filesystem.writeJson(filePath, writeState.contents)
    }

    Filesystem.readJson<SessionTabsFile>(filePath)
      .then((data) => {
        if (data && typeof data === "object" && data.byDirectory && typeof data.byDirectory === "object") {
          writeState.contents = { byDirectory: { ...data.byDirectory } }
          const pinned = data.byDirectory[directoryKey()]
          if (Array.isArray(pinned)) setStore("pinned", pinned.filter((id) => typeof id === "string"))
        }
      })
      .catch(() => {})
      .finally(() => {
        setStore("ready", true)
        if (writeState.pending) persist()
      })

    // Drop deleted sessions from the pinned list automatically.
    event.on("session.deleted", (e) => {
      const id = e.properties.info.id
      if (store.pinned.includes(id)) removeAndAdjust(id)
      if (store.visited.includes(id)) setStore("visited", store.visited.filter((x) => x !== id))
    })

    // Whenever the user navigates to a session, remember it for the rest of this
    // TUI run so it stays visible as an ephemeral tab even after navigating away.
    createEffect(() => {
      if (route.data.type !== "session") return
      const id = route.data.sessionID
      if (!id || id === "dummy") return
      if (store.pinned.includes(id)) return
      if (store.visited.includes(id)) return
      setStore("visited", [...store.visited, id])
    })

    function activeSessionID() {
      return route.data.type === "session" ? route.data.sessionID : undefined
    }

    function navigateTo(id: string | undefined) {
      if (!id) {
        route.navigate({ type: "home" })
        return
      }
      route.navigate({ type: "session", sessionID: id })
    }

    function removeAndAdjust(id: string) {
      const before = store.pinned
      const idx = before.indexOf(id)
      if (idx === -1) return
      const wasActive = activeSessionID() === id
      const next = before.filter((x) => x !== id)
      batch(() => {
        setStore("pinned", next)
        if (wasActive) {
          const fallback = next[idx] ?? next[idx - 1] ?? next[0]
          navigateTo(fallback)
        }
      })
      persist()
    }

    function pin(id: string) {
      if (store.pinned.includes(id)) return
      batch(() => {
        setStore("pinned", [...store.pinned, id])
        if (store.visited.includes(id)) setStore("visited", store.visited.filter((x) => x !== id))
      })
      persist()
    }

    function togglePin(id: string) {
      if (store.pinned.includes(id)) {
        removeAndAdjust(id)
        return
      }
      pin(id)
    }

    // Visible = pinned ∪ ephemeral. Ephemeral = visited-this-run ∪ busy, minus pinned.
    // Visited tracks every non-pinned session the user opened in this TUI run, so
    // navigating away from a fresh prompt doesn't make it disappear from the list.
    const visible = createMemo<VisibleTab[]>(() => {
      const pinnedSet = new Set(store.pinned)
      const ephemeral: string[] = []
      const seen = new Set(pinnedSet)
      for (const id of store.visited) {
        if (seen.has(id)) continue
        if (!sync.session.get(id)) continue
        ephemeral.push(id)
        seen.add(id)
      }
      const statuses = sync.data.session_status ?? {}
      for (const [id, status] of Object.entries(statuses)) {
        if (seen.has(id)) continue
        if (status?.type !== "busy" && status?.type !== "retry") continue
        if (!sync.session.get(id)) continue
        ephemeral.push(id)
        seen.add(id)
      }
      return [
        ...store.pinned.map((id) => ({ id, pinned: true })),
        ...ephemeral.map((id) => ({ id, pinned: false })),
      ]
    })

    function move(direction: 1 | -1) {
      const list = visible().map((tab) => tab.id)
      if (list.length === 0) return
      const current = activeSessionID()
      const currentIdx = current ? list.indexOf(current) : -1
      const nextIdx = currentIdx === -1 ? 0 : (currentIdx + direction + list.length) % list.length
      navigateTo(list[nextIdx])
    }

    const isPinned = (id: string) => store.pinned.includes(id)

    return {
      pinned: createMemo(() => store.pinned),
      visible,
      isPinned,
      pin,
      unpin: removeAndAdjust,
      togglePin,
      togglePinActive() {
        const id = activeSessionID()
        if (!id) return
        togglePin(id)
      },
      closeActive() {
        const id = activeSessionID()
        if (!id) return
        if (store.pinned.includes(id)) {
          removeAndAdjust(id)
          return
        }
        if (!store.visited.includes(id)) return
        // Ephemeral close: drop from visit history and step to a neighbour.
        const list = visible().map((tab) => tab.id)
        const idx = list.indexOf(id)
        const fallback = list[idx + 1] ?? list[idx - 1]
        batch(() => {
          setStore("visited", store.visited.filter((x) => x !== id))
          navigateTo(fallback)
        })
      },
      next() {
        move(1)
      },
      prev() {
        move(-1)
      },
      activate(id: string) {
        navigateTo(id)
      },
    }
  },
})
