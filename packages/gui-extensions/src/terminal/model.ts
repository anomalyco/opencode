import type { Pty } from "@opencode/schema/pty"
import { batch, createEffect, createMemo, createRoot, getOwner, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerRef, SessionView, Sessions, Storage } from "../sdk"
import { MAX_TERMINAL_SESSIONS, numberFromTitle, TerminalState, type LocalPTY } from "./state"
import { defaultTitle } from "./title"

const STORE = "terminals"
// The raw key terminals used before extensions, in the same workspace storage file.
const LEGACY = "workspace:terminal"
const HANDOFF_MAX = 40

export type TerminalModel = ReturnType<typeof createTerminalModel>
export type TerminalWorkspace = ReturnType<typeof createWorkspace>

type CacheEntry = {
  value: TerminalWorkspace
  dispose: VoidFunction
}

const workspaceKey = (server: string, directory: string) => `${server}\0${directory}`

const trimTerminal = (pty: LocalPTY) => {
  if (!pty.buffer && pty.cursor === undefined && pty.scrollY === undefined) return
  pty.buffer = undefined
  pty.cursor = undefined
  pty.scrollY = undefined
}

export function createTerminalModel(input: { storage: Storage; sessions: Sessions }) {
  const owner = getOwner()
  const cache = new Map<string, CacheEntry>()
  const [handoff] = input.storage.memory("handoff", { initial: { terminal: new Map<string, string[]>() } })
  const importGhostty = () => import("ghostty-web").then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
  const ghostty: { shared?: ReturnType<typeof importGhostty> } = {}

  const prune = () => {
    while (cache.size > MAX_TERMINAL_SESSIONS) {
      const first = cache.keys().next().value
      if (!first) return
      const entry = cache.get(first)
      entry?.dispose()
      cache.delete(first)
    }
  }

  return {
    load(session: Pick<SessionView, "server" | "directory">) {
      // Terminals are workspace-scoped so tabs persist while switching sessions in the same directory.
      const key = workspaceKey(session.server.id, session.directory)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      // A cached workspace keeps talking to its own server after the route moves on.
      const server =
        untrack(() => input.sessions.list()).find((ref) => ref.server.id === session.server.id)?.server ??
        session.server
      const directory = session.directory
      const entry = createRoot(
        (dispose) => ({ value: createWorkspace({ storage: input.storage, server, directory, key }), dispose }),
        owner,
      )

      cache.set(key, entry)
      prune()
      return entry.value
    },
    ghostty() {
      if (ghostty.shared) return ghostty.shared
      ghostty.shared = importGhostty().catch((err: unknown) => {
        ghostty.shared = undefined
        throw err
      })
      return ghostty.shared
    },
    handoff: {
      set(key: string, value: string[]) {
        const map = handoff.terminal
        map.delete(key)
        map.set(key, value)
        while (map.size > HANDOFF_MAX) {
          const first = map.keys().next().value
          if (first === undefined) return
          map.delete(first)
        }
      },
      get: (key: string) => handoff.terminal.get(key),
    },
    remove(value: { readonly server: string; readonly directory: string }) {
      const scope = { server: value.server, directory: value.directory }
      const entry = cache.get(workspaceKey(value.server, value.directory))
      if (entry) {
        entry.value.clear()
        input.storage.remove(STORE, { scope })
        return
      }
      // Opening the store imports terminals saved before extensions, so the removal drops those too.
      createRoot((dispose) => {
        const ready = input.storage.store(STORE, {
          schema: TerminalState,
          initial: { all: [] },
          scope,
          from: LEGACY,
        })[2]
        createEffect(() => {
          if (!ready()) return
          input.storage.remove(STORE, { scope })
          dispose()
        })
      }, owner)
    },
    dispose() {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    },
  }
}

function createWorkspace(input: { storage: Storage; server: ServerRef; directory: string; key: string }) {
  const location = { directory: input.directory }

  const [store, setStore, ready] = input.storage.store(STORE, {
    schema: TerminalState,
    initial: { all: [] },
    scope: { server: input.server.id, directory: input.directory },
    from: LEGACY,
  })
  const [ui, setUi] = createStore({
    focus: undefined as { request: number; id?: string; pending: boolean } | undefined,
  })
  const focus = { request: 0 }

  const requestFocus = (id?: string, pending = false) => {
    focus.request += 1
    setUi("focus", { request: focus.request, id, pending })
    return focus.request
  }

  const focusRequested = (id?: string) => {
    if (!id) return false
    if (!ui.focus || ui.focus.pending) return false
    return !ui.focus.id || ui.focus.id === id
  }

  const consumeFocus = (id: Pty.ID) => {
    if (!focusRequested(id)) return
    setUi("focus", undefined)
  }

  const cancelFocus = (request?: number) => {
    if (request !== undefined && ui.focus?.request !== request) return
    setUi("focus", undefined)
  }

  if (typeof document !== "undefined") {
    const cancelOnOutsideFocus = (event: FocusEvent) => {
      if (!ui.focus) return
      if (!(event.target instanceof Element)) return
      if (event.target.closest("#terminal-panel")) return
      cancelFocus()
    }
    document.addEventListener("focusin", cancelOnOutsideFocus)
    onCleanup(() => document.removeEventListener("focusin", cancelOnOutsideFocus))
  }

  const pickNextTerminalNumber = () => {
    const existingTitleNumbers = new Set(
      store.all.flatMap((pty) => {
        const direct = Number.isFinite(pty.titleNumber) && pty.titleNumber > 0 ? pty.titleNumber : undefined
        if (direct !== undefined) return [direct]
        const parsed = numberFromTitle(pty.title)
        if (parsed === undefined) return []
        return [parsed]
      }),
    )

    return (
      Array.from({ length: existingTitleNumbers.size + 1 }, (_, index) => index + 1).find(
        (number) => !existingTitleNumbers.has(number),
      ) ?? 1
    )
  }

  const removeExited = (id: Pty.ID) => {
    const all = store.all
    const index = all.findIndex((x) => x.id === id)
    if (index === -1) return
    const active = store.active === id ? (index === 0 ? all[1]?.id : all[0]?.id) : store.active
    setStore((draft) => {
      draft.active = active
      draft.all.splice(index, 1)
    })
  }

  // A restarted server replaces its data under the same ref, so the subscription follows it.
  createEffect(() =>
    onCleanup(
      input.server.data.on("pty.exited", (event) => {
        if (event.location?.directory !== input.directory) return
        removeExited(event.data.id)
      }),
    ),
  )

  const update = (pty: Partial<LocalPTY> & { id: Pty.ID }) => {
    const index = store.all.findIndex((x) => x.id === pty.id)
    const previous = index >= 0 ? store.all[index] : undefined
    if (index >= 0) {
      setStore((draft) => void Object.assign(draft.all[index], pty))
    }
    const doUpdate = async () => {
      await input.server.client.pty.update({
        ptyID: pty.id,
        location,
        title: pty.title,
        size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
      })
    }
    doUpdate().catch((error: unknown) => {
      if (previous) {
        const currentIndex = store.all.findIndex((item) => item.id === pty.id)
        if (currentIndex >= 0) setStore((draft) => void Object.assign(draft.all[currentIndex], previous))
      }
      console.error("Failed to update terminal", error)
    })
  }

  const clone = async (id: Pty.ID) => {
    const index = store.all.findIndex((x) => x.id === id)
    const pty = store.all[index]
    if (!pty) return
    const data = await input.server.client.pty
      .create({ location, title: pty.title })
      .then((result) => result.data)
      .catch((error: unknown) => {
        console.error("Failed to clone terminal", error)
        return undefined
      })
    if (!data?.id) return

    const active = store.active === pty.id

    setStore((draft) => {
      Object.assign(draft.all[index], {
        id: data.id,
        title: data.title ?? pty.title,
        titleNumber: pty.titleNumber,
        buffer: undefined,
        cursor: undefined,
        scrollY: undefined,
        rows: undefined,
        cols: undefined,
      })
      if (active) draft.active = data.id
    })
  }

  return {
    key: input.key,
    // An accessor, so storing the workspace in a Solid store never unwraps the host's server data.
    server: () => input.server,
    directory: input.directory,
    ready,
    all: createMemo(() => store.all),
    active: createMemo(() => store.active),
    clear() {
      setStore((draft) => {
        draft.active = undefined
        draft.all = []
      })
    },
    new() {
      const nextNumber = pickNextTerminalNumber()
      const focusRequest = requestFocus(undefined, true)

      const doCreate = async () => {
        return input.server.client.pty
          .create({ location, title: defaultTitle(nextNumber) })
          .then((result) => result.data)
      }
      doCreate()
        .then((data) => {
          const id = data?.id
          if (!id) {
            cancelFocus(focusRequest)
            return
          }
          const newTerminal = {
            id,
            title: data?.title ?? defaultTitle(nextNumber),
            titleNumber: nextNumber,
          }
          batch(() => {
            setStore((draft) => {
              draft.all.push(newTerminal)
              draft.active = id
            })
            if (ui.focus?.request === focusRequest) {
              setUi("focus", { request: focusRequest, id, pending: false })
            }
          })
        })
        .catch((error: unknown) => {
          cancelFocus(focusRequest)
          console.error("Failed to create terminal", error)
        })
    },
    update,
    trim(id: Pty.ID) {
      const index = store.all.findIndex((x) => x.id === id)
      if (index === -1) return
      setStore((draft) => trimTerminal(draft.all[index]))
    },
    trimAll() {
      setStore((draft) => draft.all.forEach(trimTerminal))
    },
    clone,
    open(id: Pty.ID) {
      setStore((draft) => {
        draft.active = id
      })
    },
    requestFocus(id?: string) {
      requestFocus(id)
    },
    focusRequested,
    consumeFocus,
    cancelFocus() {
      cancelFocus()
    },
    async close(id: Pty.ID) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index !== -1) {
        setStore((draft) => {
          if (draft.active === id) {
            draft.active = index > 0 ? draft.all[index - 1]?.id : draft.all[1]?.id
          }
          draft.all.splice(index, 1)
        })
      }

      await input.server.client.pty.remove({ ptyID: id, location }).catch((error: unknown) => {
        console.error("Failed to close terminal", error)
      })
    },
    move(id: Pty.ID, to: number) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index === -1) return
      setStore((draft) => {
        draft.all.splice(to, 0, draft.all.splice(index, 1)[0])
      })
    },
  }
}
