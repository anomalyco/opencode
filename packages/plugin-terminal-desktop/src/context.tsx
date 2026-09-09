import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode/ui/context"
import { batch, createEffect, createMemo, createRoot, on, onCleanup } from "solid-js"
import type { Context, Server, SlotMap } from "@opencode/plugin/desktop"
import { base64Encode } from "@opencode/util/encode"
import { defaultTitle, titleNumber } from "./title"
import { Persistence } from "@opencode/plugin/desktop/persistence"
import { Schema, SchemaGetter } from "effect"

const PTY = Persistence.struct({
  id: Schema.NonEmptyString,
  title: Persistence.fallback(Schema.String, () => ""),
  titleNumber: Persistence.fallback(Schema.Finite, () => 0),
  rows: Persistence.optional(Schema.Finite),
  cols: Persistence.optional(Schema.Finite),
  buffer: Persistence.optional(Schema.String),
  scrollY: Persistence.optional(Schema.Finite),
  cursor: Persistence.optional(Schema.Finite),
})

export type LocalPTY = typeof PTY.Type

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20

function numberFromTitle(title: string) {
  return titleNumber(title, MAX_TERMINAL_SESSIONS)
}

const State = Persistence.struct({
  active: Persistence.optional(Schema.String),
  all: Persistence.array(PTY),
})

export const TerminalState = State.pipe(
  Schema.decodeTo(Schema.toType(State), {
    decode: SchemaGetter.transform((value) => {
      const seen = new Set<string>()
      const all = value.all.flatMap((pty) => {
        if (seen.has(pty.id)) return []
        seen.add(pty.id)
        return [{ ...pty, titleNumber: pty.titleNumber > 0 ? pty.titleNumber : (numberFromTitle(pty.title) ?? 0) }]
      })
      return {
        active: value.active && seen.has(value.active) ? value.active : all[0]?.id,
        all,
      }
    }),
    encode: SchemaGetter.transform((value) => value),
  }),
)

export function getWorkspaceTerminalCacheKey(dir: string, serverID = "local") {
  return [serverID, dir, WORKSPACE_KEY].join("\0")
}

type TerminalSession = ReturnType<typeof createWorkspaceTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

const trimTerminal = (pty: LocalPTY) => {
  if (!pty.buffer && pty.cursor === undefined && pty.scrollY === undefined) return pty
  return {
    ...pty,
    buffer: undefined,
    cursor: undefined,
    scrollY: undefined,
  }
}

function createWorkspaceTerminalSession(ctx: Context, server: Server, directory: string) {
  const location = { directory }

  const [store, setStore, ready] = ctx.storage.persist(
    "terminals",
    TerminalState,
    { all: [] },
    { scope: { serverID: server.id, directory }, legacyKey: "terminal" },
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

  const unsub = server.data.on("pty.exited", (event) => {
    if (event.location?.directory !== directory) return
    removeExited(event.data.id)
  })
  onCleanup(unsub)

  const update = (pty: Partial<LocalPTY> & { id: string }) => {
    const index = store.all.findIndex((x) => x.id === pty.id)
    const previous = index >= 0 ? store.all[index] : undefined
    if (index >= 0) {
      setStore("all", index, (item) => ({ ...item, ...pty }))
    }
    const doUpdate = async () => {
      await server.client.pty.update({
        ptyID: pty.id,
        location,
        title: pty.title,
        size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
      })
    }
    doUpdate().catch((error: unknown) => {
      if (previous) {
        const currentIndex = store.all.findIndex((item) => item.id === pty.id)
        if (currentIndex >= 0) setStore("all", currentIndex, previous)
      }
      console.error("Failed to update terminal", error)
    })
  }

  const clone = async (id: string) => {
    const index = store.all.findIndex((x) => x.id === id)
    const pty = store.all[index]
    if (!pty) return
    const data = await server.client.pty
      .create({ location, title: pty.title })
      .then((result) => result.data)
      .catch((error: unknown) => {
        console.error("Failed to clone terminal", error)
        return undefined
      })
    if (!data?.id) return

    const active = store.active === pty.id

    batch(() => {
      setStore("all", index, {
        id: data.id,
        title: data.title ?? pty.title,
        titleNumber: pty.titleNumber,
        buffer: undefined,
        cursor: undefined,
        scrollY: undefined,
        rows: undefined,
        cols: undefined,
      })
      if (active) {
        setStore("active", data.id)
      }
    })
  }

  return {
    key: getWorkspaceTerminalCacheKey(base64Encode(directory), server.id),
    server,
    location,
    ready,
    all: createMemo(() => store.all),
    active: createMemo(() => store.active),
    clear() {
      batch(() => {
        setStore("active", undefined)
        setStore("all", [])
      })
    },
    new() {
      const nextNumber = pickNextTerminalNumber()
      const focusRequest = requestFocus(undefined, true)

      const doCreate = async () => {
        return server.client.pty.create({ location, title: defaultTitle(nextNumber) }).then((result) => result.data)
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
            setStore("all", store.all.length, newTerminal)
            setStore("active", id)
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
    update(pty: Partial<LocalPTY> & { id: string }) {
      update(pty)
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
      await clone(id)
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

      await server.client.pty.remove({ ptyID: id, location }).catch((error: unknown) => {
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

export function createTerminalRuntime(ctx: Context) {
  const cache = new Map<string, TerminalCacheEntry>()
  const [handoff, updateHandoff] = ctx.storage.memory("handoff", {
    initial: { titles: {} as Record<string, string[]> },
  })
  onCleanup(() => {
    cache.forEach((entry) => entry.dispose())
    cache.clear()
  })
  ctx.workspaces.onRemoved(({ serverID, directory }) => {
    const key = getWorkspaceTerminalCacheKey(base64Encode(directory), serverID)
    const entry = cache.get(key)
    entry?.value.clear()
    entry?.dispose()
    cache.delete(key)
    updateHandoff((draft) => {
      delete draft.titles[key]
    })
    ctx.storage.remove("terminals", { scope: { serverID, directory }, legacyKey: "terminal" })
  })
  return {
    workspace(server: Server, directory: string) {
      const key = getWorkspaceTerminalCacheKey(base64Encode(directory), server.id)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }
      const entry = createRoot((dispose) => ({
        value: createWorkspaceTerminalSession(ctx, server, directory),
        dispose,
      }))
      cache.set(key, entry)
      Array.from(cache)
        .filter(([, entry]) => entry.value.server.id === server.id)
        .slice(0, -MAX_TERMINAL_SESSIONS)
        .forEach(([key, entry]) => {
          entry.dispose()
          cache.delete(key)
        })
      return entry.value
    },
    handoff: (key: string) => handoff.titles[key] ?? [],
    setHandoff(key: string, titles: string[]) {
      updateHandoff((draft) => {
        delete draft.titles[key]
        draft.titles[key] = titles
        Object.keys(draft.titles)
          .slice(0, -40)
          .forEach((key) => {
            delete draft.titles[key]
          })
      })
    },
  }
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "TerminalExtension",
  gate: false,
  init: (props: { runtime: ReturnType<typeof createTerminalRuntime>; input: SlotMap["session.auxiliary"] }) => {
    const workspace = createMemo(() =>
      props.runtime.workspace(props.input.session.server, props.input.services.files.directory),
    )
    createEffect(
      on(
        workspace,
        (next, previous) => {
          if (previous && previous !== next) previous.trimAll()
        },
        { defer: true },
      ),
    )
    return {
      workspaceKey: () => workspace().key,
      directory: () => workspace().location.directory,
      view: () => props.input.services.view,
      presentation: () => props.input.presentation,
      handoff: props.runtime.handoff,
      setHandoff: props.runtime.setHandoff,
      ready: () => workspace().ready(),
      all: () => workspace().all(),
      active: () => workspace().active(),
      new: () => workspace().new(),
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
