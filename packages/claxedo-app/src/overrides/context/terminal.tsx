import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createRoot, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { clearInitialCommandMarker } from "../components/terminal-recovery"
import { mergeCreatedTerminal, type LocalPTY } from "./terminal-shared"
export type { LocalPTY } from "./terminal-shared"

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20
const SERVER_SCOPED_PERSIST = import.meta.env.VITE_SERVER_SCOPED_PERSIST === "true"

type TerminalSession = ReturnType<typeof createTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

function debugLevel() {
  if (typeof localStorage === "undefined") return 0
  const raw = localStorage.getItem("opencode.debug.terminal")
  if (!raw) return 0
  if (raw === "true") return 1
  if (raw === "false") return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  return n
}

function tlog(...args: unknown[]) {
  if (debugLevel() < 1) return
  // eslint-disable-next-line no-console
  console.log("[terminal:store]", ...args)
}

function tvlog(...args: unknown[]) {
  if (debugLevel() < 2) return
  // eslint-disable-next-line no-console
  console.log("[terminal:store:verbose]", ...args)
}

export function createTerminalSession(sdk: ReturnType<typeof useSDK>, dir: string, session?: string) {
  const legacy = session ? [`${dir}/terminal/${session}.v1`, `${dir}/terminal.v1`] : [`${dir}/terminal.v1`]

  const numberFromTitle = (title: string) => {
    const m = title.match(/^Terminal (\d+)$/)
    if (!m) return
    const n = Number(m[1])
    if (!Number.isFinite(n) || n <= 0) return
    return n
  }

  const [store, setStore, _, ready] = persisted(
    SERVER_SCOPED_PERSIST ? Persist.serverWorkspace(sdk.url, dir, "terminal", legacy) : Persist.workspace(dir, "terminal", legacy),
    createStore<{
      active?: string
      all: LocalPTY[]
    }>({
      all: [],
    }),
  )

  const unsub = sdk.event.on("pty.exited", (event) => {
    const id = event.properties.id
    tlog("event pty.exited", { dir, id, known: store.all.some((x) => x.id === id) })
    if (!store.all.some((x) => x.id === id)) return
    batch(() => {
      setStore(
        "all",
        store.all.filter((x) => x.id !== id),
      )
      if (store.active === id) {
        const remaining = store.all.filter((x) => x.id !== id)
        setStore("active", remaining[0]?.id)
      }
    })
    clearInitialCommandMarker(id)
  })
  onCleanup(unsub)

  const unsubCreated = sdk.event.on("pty.created", (event) => {
    const info = event.properties.info
    if (!info?.id) return
    const cmd = pendingInitialCommand
    pendingInitialCommand = undefined
    tlog("event pty.created", { dir, id: info.id, title: info.title, cwd: info.cwd, pendingCmd: !!cmd })
    setStore("all", (all) => {
      const merged = mergeCreatedTerminal(all, { id: info.id, title: info.title, cwd: info.cwd })
      if (!cmd) return merged
      const idx = merged.findIndex((item) => item.id === info.id)
      if (idx === -1) return merged
      return merged.map((item, i) => (i === idx ? { ...item, initialCommand: cmd } : item))
    })
    if (!store.active) setStore("active", info.id)
    tvlog("after pty.created", { dir, active: store.active, ids: store.all.map((x) => x.id) })
  })
  onCleanup(unsubCreated)

  const unsubUpdated = sdk.event.on("pty.updated", (event) => {
    const info = event.properties.info
    const index = store.all.findIndex((x) => x.id === info.id)
    tlog("event pty.updated", { dir, id: info.id, index, title: info.title, cwd: info.cwd })
    if (index === -1) return
    setStore("all", index, (existing) => ({
      ...existing,
      title: info.title ?? existing.title,
      cwd: info.cwd ?? existing.cwd,
    }))
  })
  onCleanup(unsubUpdated)

  const unsubDeleted = sdk.event.on("pty.deleted", (event) => {
    const id = event.properties.id
    tlog("event pty.deleted", { dir, id, known: store.all.some((x) => x.id === id) })
    if (!store.all.some((x) => x.id === id)) return
    batch(() => {
      setStore(
        "all",
        store.all.filter((x) => x.id !== id),
      )
      if (store.active === id) {
        const remaining = store.all.filter((x) => x.id !== id)
        setStore("active", remaining[0]?.id)
      }
    })
    clearInitialCommandMarker(id)
  })
  onCleanup(unsubDeleted)

  // Pending initial command for terminals created by new().
  // The pty.created SSE event arrives before the HTTP .then() callback,
  // so the event handler adds the PTY to the store without initialCommand.
  // The Terminal component mounts with a stale reference and never sees it.
  // This variable bridges the gap: new() sets it before the API call,
  // and the event handler consumes it when adding the PTY.
  let pendingInitialCommand: string | undefined

  const meta = { migrated: false, reconciled: false }

  // Migration effect for titleNumber
  createEffect(() => {
    if (!ready()) return
    if (meta.migrated) return
    meta.migrated = true

    setStore("all", (all) => {
      const next = all.map((pty) => {
        const direct = Number.isFinite(pty.titleNumber) && pty.titleNumber > 0 ? pty.titleNumber : undefined
        if (direct !== undefined) return pty
        const parsed = numberFromTitle(pty.title)
        if (parsed === undefined) return pty
        return { ...pty, titleNumber: parsed }
      })
      if (next.every((pty, index) => pty === all[index])) return all
      return next
    })
  })

  // Reconcile persisted store.all against live server PTYs on load.
  // Removes PTY entries that no longer exist on the server (e.g. server
  // restarted, PTY exited while frontend was disconnected, stale localStorage).
  createEffect(() => {
    if (!ready()) return
    if (meta.reconciled) return
    if (store.all.length === 0) return
    meta.reconciled = true

    sdk.client.pty.list().then((res) => {
      const serverIds = new Set((res.data ?? []).map((p: { id: string }) => p.id))
      const stale = store.all.filter((p) => !serverIds.has(p.id))
      if (stale.length === 0) return
      tlog("reconcile: pruning stale PTYs", { stale: stale.map((p) => p.id), server: [...serverIds] })
      batch(() => {
        setStore("all", (all) => all.filter((p) => serverIds.has(p.id)))
        if (store.active && !serverIds.has(store.active)) {
          const remaining = store.all.filter((p) => serverIds.has(p.id))
          setStore("active", remaining[0]?.id)
        }
      })
    }).catch((e) => {
      // If the server is unreachable, skip reconciliation — we'll try again on next load
      tlog("reconcile: failed to list PTYs", e)
    })
  })

  return {
    ready,
    all: createMemo(() => Object.values(store.all)),
    active: createMemo(() => store.active),
    new(initialCommand?: string, title?: string) {
      // Enable with: localStorage.setItem("opencode.debug.terminal","1")
      const debug = typeof localStorage !== "undefined" && localStorage.getItem("opencode.debug.terminal") === "1"
      if (debug) {
        // eslint-disable-next-line no-console
        console.log("[terminal]", "new()", { dir, count: store.all.length, initialCommand, title })
      }
      tvlog("new() pre", { dir, all: store.all.map((x) => ({ id: x.id, title: x.title })), active: store.active })

      const existingTitleNumbers = new Set(
        store.all.flatMap((pty) => {
          const direct = Number.isFinite(pty.titleNumber) && pty.titleNumber > 0 ? pty.titleNumber : undefined
          if (direct !== undefined) return [direct]
          const parsed = numberFromTitle(pty.title)
          if (parsed === undefined) return []
          return [parsed]
        }),
      )

      const nextNumber =
        Array.from({ length: existingTitleNumbers.size + 1 }, (_, index) => index + 1).find(
          (number) => !existingTitleNumbers.has(number),
        ) ?? 1

      // Get server port from SDK URL for agent hooks
      const serverPort = (() => {
        try {
          const url = new URL(sdk.url)
          return url.port || (url.protocol === "https:" ? "443" : "80")
        } catch {
          return "7860"
        }
      })()

      // Use provided title or default to "Terminal N"
      const terminalTitle = title ? `${title} ${nextNumber}` : `Terminal ${nextNumber}`

      // Set before the API call so the pty.created event handler can pick it up.
      // The event fires before .then() resolves, so this bridges the gap.
      if (initialCommand) pendingInitialCommand = initialCommand

      sdk.client.pty
        .create({
          title: terminalTitle,
          // Pass agent hooks environment variables
          // CLAXEDO_TAB_ID will be set to the PTY ID since the tab is created after
          // The listener will find the tab by terminalId
          env: {
            CLAXEDO_PORT: serverPort,
            CLAXEDO_WORKSPACE_ID: dir,
          },
        })
        .then((pty) => {
          pendingInitialCommand = undefined
          const id = pty.data?.id
          if (!id) return
          if (debug) {
            // eslint-disable-next-line no-console
            console.log("[terminal]", "created", { id, title: terminalTitle, cwd: pty.data?.cwd, initialCommand })
          }
          setStore("all", (all) => {
            const merged = mergeCreatedTerminal(all, { id, title: terminalTitle, cwd: pty.data?.cwd })
            const idx = merged.findIndex((item) => item.id === id)
            if (idx === -1) return merged
            if (!initialCommand) return merged
            if (merged[idx].initialCommand) return merged
            return merged.map((item, i) => (i === idx ? { ...item, initialCommand } : item))
          })
          setStore("active", id)
          tvlog("new() post create", { dir, id, all: store.all.map((x) => x.id), active: store.active })
        })
        .catch((e) => {
          pendingInitialCommand = undefined
          if (debug) {
            // eslint-disable-next-line no-console
            console.log("[terminal]", "create failed", e)
          }
          console.error("Failed to create terminal", e)
        })
    },
    update(pty: Partial<LocalPTY> & { id: string }) {
      tvlog("update()", { dir, id: pty.id, patch: pty })
      const index = store.all.findIndex((x) => x.id === pty.id)
      if (index === -1) return
      setStore("all", index, (existing) => ({ ...existing, ...pty }))
      sdk.client.pty
        .update({
          ptyID: pty.id,
          title: pty.title,
          size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
        })
        .catch((e) => {
          console.error("Failed to update terminal", e)
        })
    },
    async clone(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      const pty = store.all[index]
      if (!pty) return
      const clone = await sdk.client.pty
        .create({
          title: pty.title,
        })
        .catch((e) => {
          console.error("Failed to clone terminal", e)
          return undefined
        })
      if (!clone?.data) return

      const active = store.active === pty.id

      batch(() => {
        setStore("all", index, {
          id: clone.data.id,
          title: clone.data.title ?? pty.title,
          titleNumber: pty.titleNumber,
          cwd: clone.data.cwd,
        })
        if (active) {
          setStore("active", clone.data.id)
        }
      })
    },
    open(id: string) {
      setStore("active", id)
    },
    next() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const nextIndex = (index + 1) % store.all.length
      setStore("active", store.all[nextIndex]?.id)
    },
    previous() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const prevIndex = index === 0 ? store.all.length - 1 : index - 1
      setStore("active", store.all[prevIndex]?.id)
    },
    async close(id: string) {
      tlog("close()", { dir, id, before: store.all.map((x) => x.id), active: store.active })
      batch(() => {
        const filtered = store.all.filter((x) => x.id !== id)
        if (store.active === id) {
          const index = store.all.findIndex((f) => f.id === id)
          const next = index > 0 ? index - 1 : 0
          setStore("active", filtered[next]?.id)
        }
        setStore("all", filtered)
      })

      await sdk.client.pty.remove({ ptyID: id }).catch((e) => {
        console.error("Failed to close terminal", e)
      })
      tvlog("close() post", { dir, id, after: store.all.map((x) => x.id), active: store.active })
    },
    move(id: string, to: number) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index === -1) return
      setStore(
        "all",
        produce((all) => {
          all.splice(to, 0, all.splice(index, 1)[0])
        }),
      )
    },
  }
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "Terminal",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const params = useParams()
    const cache = new Map<string, TerminalCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_TERMINAL_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const load = (dir: string, session?: string) => {
      const key = SERVER_SCOPED_PERSIST ? `${sdk.url}:${dir}:${WORKSPACE_KEY}` : `${dir}:${WORKSPACE_KEY}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createTerminalSession(sdk, dir, session),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const workspace = createMemo(() => load(params.dir!, params.id))

    // Cache last workspace so cleanup callbacks (e.g. Terminal onCleanup saving
    // buffer state) can access it without re-evaluating the memo. Re-evaluation
    // during teardown reads params.dir which may come from a disposed <Show>/<Route>,
    // causing a "stale value from <Show>" error.
    let lastWorkspace: TerminalSession | undefined
    createEffect(() => {
      lastWorkspace = workspace()
    })

    const safeWorkspace = () => {
      try {
        return workspace()
      } catch {
        return lastWorkspace
      }
    }

    return {
      ready: () => workspace().ready(),
      all: () => workspace().all(),
      active: () => workspace().active(),
      new: (initialCommand?: string, title?: string) => workspace().new(initialCommand, title),
      update: (pty: Partial<LocalPTY> & { id: string }) => safeWorkspace()?.update(pty),
      clone: (id: string) => workspace().clone(id),
      open: (id: string) => workspace().open(id),
      close: (id: string) => safeWorkspace()?.close(id),
      move: (id: string, to: number) => workspace().move(id, to),
      next: () => workspace().next(),
      previous: () => workspace().previous(),
    }
  },
})
