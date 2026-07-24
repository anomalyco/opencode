import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createRoot, on, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK, type DirectorySDK } from "./sdk"
import type { Platform } from "./platform"
import { useServerSDK } from "./server-sdk"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { defaultTitle, titleNumber } from "./terminal-title"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { ScopedKey, ServerScope, type ServerScope as ServerScopeValue } from "@/utils/server-scope"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  cursor?: number
}

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function numberFromTitle(title: string) {
  return titleNumber(title, MAX_TERMINAL_SESSIONS)
}

function pty(value: unknown): LocalPTY | undefined {
  if (!record(value)) return

  const id = text(value.id)
  if (!id) return

  const title = text(value.title) ?? ""
  const number = num(value.titleNumber)
  const rows = num(value.rows)
  const cols = num(value.cols)
  const buffer = text(value.buffer)
  const scrollY = num(value.scrollY)
  const cursor = num(value.cursor)

  return {
    id,
    title,
    titleNumber: number && number > 0 ? number : (numberFromTitle(title) ?? 0),
    ...(rows !== undefined ? { rows } : {}),
    ...(cols !== undefined ? { cols } : {}),
    ...(buffer !== undefined ? { buffer } : {}),
    ...(scrollY !== undefined ? { scrollY } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  }
}

export function migrateTerminalState(value: unknown) {
  if (!record(value)) return value

  const seen = new Set<string>()
  const all = (Array.isArray(value.all) ? value.all : []).flatMap((item) => {
    const next = pty(item)
    if (!next || seen.has(next.id)) return []
    seen.add(next.id)
    return [next]
  })

  const active = text(value.active)

  return {
    active: active && seen.has(active) ? active : all[0]?.id,
    all,
  }
}

export function getWorkspaceTerminalCacheKey(dir: string, scope: ServerScopeValue = ServerScope.local) {
  return ScopedKey.from(scope, dir, WORKSPACE_KEY)
}

export function getLegacyTerminalStorageKeys(dir: string, legacySessionID?: string) {
  if (!legacySessionID) return [`${dir}/terminal.v1`]
  return [`${dir}/terminal/${legacySessionID}.v1`, `${dir}/terminal.v1`]
}

type TerminalSession = ReturnType<typeof createWorkspaceTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

const caches = new Set<Map<string, TerminalCacheEntry>>()

const trimTerminal = (pty: LocalPTY) => {
  if (!pty.buffer && pty.cursor === undefined && pty.scrollY === undefined) return pty
  return {
    ...pty,
    buffer: undefined,
    cursor: undefined,
    scrollY: undefined,
  }
}

function terminalPersistTarget(scope: ServerScopeValue, dir: string, legacy?: string[]) {
  return Persist.serverWorkspace(scope, dir, "terminal", legacy)
}

export function clearWorkspaceTerminals(
  dir: string,
  sessionIDs?: string[],
  platform?: Platform,
  scope: ServerScopeValue = ServerScope.local,
) {
  const key = getWorkspaceTerminalCacheKey(dir, scope)
  for (const cache of caches) {
    const entry = cache.get(key)
    entry?.value.clear()
  }

  void removePersisted(terminalPersistTarget(scope, dir), platform)

  if (scope !== ServerScope.local) return
  const legacy = new Set(getLegacyTerminalStorageKeys(dir))
  for (const id of sessionIDs ?? []) {
    for (const key of getLegacyTerminalStorageKeys(dir, id)) {
      legacy.add(key)
    }
  }
  for (const key of legacy) {
    void removePersisted({ key }, platform)
  }
}

function createWorkspaceTerminalSession(
  sdk: DirectorySDK,
  dir: string,
  scope: ServerScopeValue,
  legacySessionID?: string,
) {
  const legacy = scope === ServerScope.local ? getLegacyTerminalStorageKeys(dir, legacySessionID) : []

  const [store, setStore, _, ready] = persisted(
    {
      ...terminalPersistTarget(scope, dir, legacy),
      migrate: migrateTerminalState,
    },
    createStore<{
      active?: string
      all: LocalPTY[]
    }>({
      all: [],
    }),
  )
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

  const consumeFocus = (id: string) => {
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

  const removeExited = (id: string) => {
    const all = store.all
    const index = all.findIndex((x) => x.id === id)
    if (index === -1) return
    const active = store.active === id ? (index === 0 ? all[1]?.id : all[0]?.id) : store.active
    batch(() => {
      setStore("active", active)
      setStore(
        "all",
        produce((draft) => {
          draft.splice(index, 1)
        }),
      )
    })
  }

  const unsub = sdk.event.on("pty.exited", (event: { properties: { id: string } }) => {
    removeExited(event.properties.id)
  })
  onCleanup(unsub)

  const update = (client: DirectorySDK["client"], pty: Partial<LocalPTY> & { id: string }) => {
    const index = store.all.findIndex((x) => x.id === pty.id)
    const previous = index >= 0 ? store.all[index] : undefined
    if (index >= 0) {
      setStore("all", index, (item) => ({ ...item, ...pty }))
    }
    client.pty
      .update({
        ptyID: pty.id,
        title: pty.title,
        size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
      })
      .catch((error: unknown) => {
        if (previous) {
          const currentIndex = store.all.findIndex((item) => item.id === pty.id)
          if (currentIndex >= 0) setStore("all", currentIndex, previous)
        }
        console.error("Failed to update terminal", error)
      })
  }

  const clone = async (client: DirectorySDK["client"], id: string) => {
    const index = store.all.findIndex((x) => x.id === id)
    const pty = store.all[index]
    if (!pty) return
    const next = await client.pty
      .create({
        title: pty.title,
      })
      .catch((error: unknown) => {
        console.error("Failed to clone terminal", error)
        return undefined
      })
    if (!next?.data) return

    const active = store.active === pty.id

    batch(() => {
      setStore("all", index, {
        id: next.data.id,
        title: next.data.title ?? pty.title,
        titleNumber: pty.titleNumber,
        buffer: undefined,
        cursor: undefined,
        scrollY: undefined,
        rows: undefined,
        cols: undefined,
      })
      if (active) {
        setStore("active", next.data.id)
      }
    })
  }

  return {
    ready,
    all: createMemo(() => store.all),
    active: createMemo(() => store.active),
    clear() {
      batch(() => {
        setStore("active", undefined)
        setStore("all", [])
      })
    },
    new(options?: { focus?: boolean }) {
      const nextNumber = pickNextTerminalNumber()
      const focusRequest = options?.focus ? requestFocus(undefined, true) : undefined

      sdk.client.pty
        .create({ title: defaultTitle(nextNumber) })
        .then((pty: { data?: { id?: string; title?: string } }) => {
          const id = pty.data?.id
          if (!id) {
            if (focusRequest !== undefined) cancelFocus(focusRequest)
            return
          }
          const newTerminal = {
            id,
            title: pty.data?.title ?? defaultTitle(nextNumber),
            titleNumber: nextNumber,
          }
          batch(() => {
            setStore("all", store.all.length, newTerminal)
            setStore("active", id)
            if (focusRequest !== undefined && ui.focus?.request === focusRequest) {
              setUi("focus", { request: focusRequest, id, pending: false })
            }
          })
        })
        .catch((error: unknown) => {
          if (focusRequest !== undefined) cancelFocus(focusRequest)
          console.error("Failed to create terminal", error)
        })
    },
    update(pty: Partial<LocalPTY> & { id: string }) {
      update(sdk.client, pty)
    },
    trim(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      if (index === -1) return
      setStore("all", index, (pty) => trimTerminal(pty))
    },
    trimAll() {
      setStore("all", (all) => {
        const next = all.map(trimTerminal)
        if (next.every((pty, index) => pty === all[index])) return all
        return next
      })
    },
    async clone(id: string) {
      await clone(sdk.client, id)
    },
    bind() {
      const client = sdk.client
      return {
        trim(id: string) {
          const index = store.all.findIndex((x) => x.id === id)
          if (index === -1) return
          setStore("all", index, (pty) => trimTerminal(pty))
        },
        update(pty: Partial<LocalPTY> & { id: string }) {
          update(client, pty)
        },
        async clone(id: string) {
          await clone(client, id)
        },
      }
    },
    open(id: string) {
      setStore("active", id)
    },
    requestFocus(id?: string) {
      requestFocus(id)
    },
    focusRequested(id?: string) {
      return focusRequested(id)
    },
    consumeFocus(id: string) {
      consumeFocus(id)
    },
    cancelFocus() {
      cancelFocus()
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
      const index = store.all.findIndex((f) => f.id === id)
      if (index !== -1) {
        batch(() => {
          if (store.active === id) {
            const next = index > 0 ? store.all[index - 1]?.id : store.all[1]?.id
            setStore("active", next)
          }
          setStore(
            "all",
            produce((all) => {
              all.splice(index, 1)
            }),
          )
        })
      }

      await sdk.client.pty.remove({ ptyID: id }).catch((error: unknown) => {
        console.error("Failed to close terminal", error)
      })
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
    const serverSDK = useServerSDK()
    const params = useParams()
    const cache = new Map<string, TerminalCacheEntry>()
    const scope = () => serverSDK().scope
    const directory = createMemo(() => base64Encode(sdk().directory))

    caches.add(cache)
    onCleanup(() => caches.delete(cache))

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

    const loadWorkspace = (dir: string, legacySessionID: string | undefined, serverScope: ServerScopeValue) => {
      // Terminals are workspace-scoped so tabs persist while switching sessions in the same directory.
      const key = getWorkspaceTerminalCacheKey(dir, serverScope)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createWorkspaceTerminalSession(sdk(), dir, serverScope, legacySessionID),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const workspace = createMemo(() => loadWorkspace(directory(), params.id, scope()))

    createEffect(
      on(
        () => ({ dir: directory(), id: params.id, scope: scope() }),
        (next, prev) => {
          if (!prev?.dir) return
          if (next.dir === prev.dir && next.id === prev.id && next.scope === prev.scope) return
          if (next.dir === prev.dir && next.id && next.scope === prev.scope) return
          loadWorkspace(prev.dir, prev.id, prev.scope).trimAll()
        },
        { defer: true },
      ),
    )

    return {
      ready: () => workspace().ready(),
      all: () => workspace().all(),
      active: () => workspace().active(),
      new: (options?: { focus?: boolean }) => workspace().new(options),
      update: (pty: Partial<LocalPTY> & { id: string }) => workspace().update(pty),
      trim: (id: string) => workspace().trim(id),
      trimAll: () => workspace().trimAll(),
      clone: (id: string) => workspace().clone(id),
      bind: () => workspace(),
      open: (id: string) => workspace().open(id),
      requestFocus: (id?: string) => workspace().requestFocus(id),
      focusRequested: (id?: string) => workspace().focusRequested(id),
      consumeFocus: (id: string) => workspace().consumeFocus(id),
      cancelFocus: () => workspace().cancelFocus(),
      close: (id: string) => workspace().close(id),
      move: (id: string, to: number) => workspace().move(id, to),
      next: () => workspace().next(),
      previous: () => workspace().previous(),
    }
  },
})
