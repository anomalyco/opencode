import { createRoot, getOwner, runWithOwner, type Owner } from "solid-js"
import { createStore } from "solid-js/store"
import { Predicate, Schema } from "effect"
import {
  ClientError,
  isPtyFeatureUnsupportedError,
  isServiceUnavailableError,
  type PersistentPtyInfo,
} from "@opencode/client"
import {
  createKeyed,
  type Layout,
  type Persisted,
  type ServerRef,
  type SessionRef,
  type Storage,
  type Toasts,
} from "@opencode/plugin/gui"
import { defaultTitle, titleNumber } from "./title"

// The keys terminals were stored under before they lived on the server. Their PTY ids no longer exist anywhere.
const LEGACY = { key: "terminals", from: "workspace:terminal" }

const Selected = Schema.Struct({ id: Schema.optional(Schema.String) })

export type TerminalModel = ReturnType<typeof createTerminalModel>

export type TerminalSession = ReturnType<TerminalModel["load"]>

type FocusRequest = { key: string; request: number; id?: string; pending: boolean }

const importGhostty = () => import("ghostty-web").then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))

/** The one ghostty-web load the window's terminals share; a failed load is retried by the next terminal. */
type Ghostty = { shared?: ReturnType<typeof importGhostty> }

/**
 * Mirrors each session's terminals from its server, like the TUI: the server's list is the only record of which
 * terminals exist, refreshed on its terminal events and on every reconnect. Only the selected terminal per session is
 * stored.
 */
export function createTerminalModel(input: {
  storage: Storage
  layout: Pick<Layout, "open" | "stored">
  toast: Pick<Toasts, "show">
  t: (key: string) => string
  /** The panel key of a terminal's side panel tab. */
  tab: (ptyID: string) => string
}) {
  const owner = getOwner()

  const [lists, setLists] = input.storage.memory<{ sessions: Record<string, readonly PersistentPtyInfo[]> }>("lists", {
    initial: { sessions: {} },
  })

  const [state, setState] = createStore<{ capabilities: Record<string, boolean>; focus?: FocusRequest }>({
    capabilities: {},
  })

  const sessions = new Map<string, SessionRef>()
  const handles = new Map<string, ReturnType<typeof handle>>()
  const selected = new Map<string, Persisted<typeof Selected.Type>>()
  const sequence = new Map<string, number>()
  const watched = new Map<string, { data: ServerRef["data"]; stop: VoidFunction }>()
  const cleared = new Set<string>()
  const cleanups: VoidFunction[] = []
  const ghostty: Ghostty = {}
  const focus = { request: 0 }

  const available = (server: ServerRef) => {
    watch(server)

    return state.capabilities[server.id] !== false
  }

  const refresh = async (session: SessionRef) => {
    const next = (sequence.get(session.key) ?? 0) + 1

    sequence.set(session.key, next)
    const list = await session.server.client.experimental.persistentPty.list({ sessionID: session.id })

    // A newer refresh started meanwhile; its answer wins.
    if (sequence.get(session.key) !== next) return
    setLists((draft) => void (draft.sessions[session.key] = list))
    dropLegacy(session)
    // The strip shows only stored tabs, so terminals another client created join it at the end.
    const stored = new Set(input.layout.stored(session))

    list.forEach((info) => {
      if (!stored.has(info.id)) input.layout.open(input.tab(info.id), session, { tab: "append" })
    })
  }

  // Replaces a listed terminal's info; a terminal the list doesn't have yet arrives with the next refresh.
  const replace = (key: string, terminal: PersistentPtyInfo) =>
    setLists((draft) => {
      const list = draft.sessions[key]
      const index = list?.findIndex((info) => info.id === terminal.id) ?? -1

      if (list && index !== -1) draft.sessions[key] = list.with(index, terminal)
    })

  // A server whose terminal daemon can't run answers 503; like a server reporting no support, it offers no terminals
  // until the next connection checks again.
  const listed = (session: SessionRef) =>
    refresh(session).catch((error) => {
      if (!isServiceUnavailableError(error)) return console.error("Failed to list terminals", error)
      setState("capabilities", session.server.id, false)
      setLists((draft) => void (draft.sessions[session.key] = []))
    })

  const refreshQuietly = (session: SessionRef) => void listed(session)

  const refreshServer = (server: ServerRef) =>
    sessions.forEach((session) => {
      if (session.server.id === server.id) refreshQuietly(session)
    })

  const sync = (server: ServerRef) =>
    void server.client.server
      .info()
      .then((info) => {
        // Servers that predate the field omit it; they still offer terminals.
        const supported = info.capabilities?.persistentPty !== false

        setState("capabilities", server.id, supported)

        if (supported) refreshServer(server)
      })
      .catch((error) => {
        // Like the TUI: unknown support offers no terminals until the next connection checks again.
        setState("capabilities", server.id, false)
        console.error("Failed to read server terminal support", error)
      })

  // A restarted server replaces its data under the same ref, so reads that track `server.data` subscribe again.
  const watch = (server: ServerRef) => {
    const data = server.data
    const current = watched.get(server.id)

    if (current?.data === data) return
    current?.stop()

    const refreshSession = (sessionID: string) => {
      const session = sessions.get(`${server.id}\n${sessionID}`)

      if (session && state.capabilities[server.id]) refreshQuietly(session)
    }

    // Subscriptions end with the owner they start under, and this runs from whichever computation first read the
    // server, so they belong to the model.
    const stops = runWithOwner(owner, () => [
      // The event stream opens with server.connected, so this runs for the first connection and every reconnect.
      data.on("server.connected", () => sync(server)),
      data.on("persistent-pty.added", (event) => refreshSession(event.data.sessionID)),
      data.on("persistent-pty.removed", (event) => refreshSession(event.data.sessionID)),
      data.on("persistent-pty.updated", (event) => {
        const key = `${server.id}\n${event.data.sessionID}`

        if (!lists.sessions[key]?.some((info) => info.id === event.data.terminal.id))
          return refreshSession(event.data.sessionID)

        replace(key, event.data.terminal)
      }),
    ])!

    watched.set(server.id, { data, stop: () => stops.forEach((stop) => stop()) })
    sync(server)
  }

  const selection = (session: SessionRef) => {
    const existing = selected.get(session.key)

    if (existing) return existing

    // Opened from reactive reads, so it belongs to the model rather than the computation that first asked.
    const created = runWithOwner(owner, () =>
      input.storage.store("selected", { schema: Selected, initial: {}, scope: { session } }),
    )!

    selected.set(session.key, created)

    return created
  }

  const requestFocus = (key: string, id?: string, pending = false) => {
    focus.request += 1
    setState("focus", { key, request: focus.request, id, pending })

    return focus.request
  }

  const cancelFocus = (request?: number) => {
    if (request !== undefined && state.focus?.request !== request) return

    setState("focus", undefined)
  }

  if (typeof document !== "undefined") {
    const cancelOnOutsideFocus = (event: FocusEvent) => {
      if (!state.focus) return

      if (!(event.target instanceof Element)) return

      // The side region focuses its selected tab trigger or root while switching tabs; only focus leaving it, or
      // entering a field in it such as a tab's rename field, cancels.
      if (event.target.closest("#terminal-panel, #review-panel") && !(event.target instanceof HTMLInputElement)) return

      cancelFocus()
    }

    // Capture phase: a tab's rename field stops its focusin from bubbling.
    document.addEventListener("focusin", cancelOnOutsideFocus, true)
    cleanups.push(() => document.removeEventListener("focusin", cancelOnOutsideFocus, true))
  }

  const handle = (initial: SessionRef) => {
    const key = initial.key
    // A removed workspace forgets its session, while a component may still hold the handle.
    const session = () => sessions.get(key) ?? initial
    const all = () => lists.sessions[key] ?? []
    const get = (id: string) => all().find((info) => info.id === id)

    const focusRequested = (id?: string) => {
      if (!id || !state.focus || state.focus.pending || state.focus.key !== key) return false

      return !state.focus.id || state.focus.id === id
    }

    return {
      key,
      server: () => session().server,
      /** The server answered this session's first terminal list. */
      ready: () => lists.sessions[key] !== undefined,
      /** The session's terminals, in the server's order. */
      all,
      get,
      /** The selected terminal, else the first one. */
      active() {
        const id = selection(session()).value?.id

        return id && get(id) ? id : all()[0]?.id
      },
      select(id: string) {
        selection(session()).set({ id })
      },
      refresh: () => refresh(session()),
      /** Creates a terminal and selects it; resolves its id, or undefined when the server refuses. */
      async new() {
        const target = session()
        const request = requestFocus(key, undefined, true)

        await settled(target, owner)

        // The next default title counts the terminals the server already has.
        if (lists.sessions[key] === undefined) await refresh(target).catch(() => undefined)

        const used = new Set(all().flatMap((info) => titleNumber(info.title) ?? []))
        const number = Array.from({ length: used.size + 1 }, (_, index) => index + 1).find((n) => !used.has(n)) ?? 1

        const info = await target.server.client.experimental.persistentPty
          .create({
            sessionID: target.id,
            args: [],
            // A session that moved keeps its object; the server's record has the directory it runs in now.
            cwd: target.server.data.session.get(target.id)?.location.directory ?? target.location?.directory,
            title: defaultTitle(number),
            env: {},
          })
          .catch((error) => {
            cancelFocus(request)

            // A server without the persistent terminal routes answers with a status its API never declares for them.
            const outdated =
              error instanceof ClientError &&
              error.reason === "UnexpectedStatus" &&
              Predicate.hasProperty(error.cause, "status") &&
              (error.cause.status === 404 || error.cause.status === 405)

            input.toast.show(
              outdated
                ? { variant: "error", title: input.t("create.unsupported") }
                : {
                    variant: "error",
                    title: input.t("create.failed"),
                    description: error instanceof Error ? error.message : String(error),
                  },
            )

            return undefined
          })

        if (!info) return undefined

        await listed(target)
        selection(target).set({ id: info.id })

        if (state.focus?.request === request) setState("focus", { key, request, id: info.id, pending: false })

        return info.id
      },
      /** Removes the terminal on the server; its tab leaves once the server lists it no longer. */
      async close(id: string) {
        const target = session()

        await target.server.client.experimental.persistentPty
          .remove({ ptyID: id })
          .then(() => refresh(target))
          .catch((error) => console.error("Failed to close terminal", error))
      },
      /**
       * Sets the terminal's title on the server; `null` clears it, so the shell's or the default title shows again.
       * The current title, or clearing a terminal never renamed, sends nothing.
       */
      async rename(id: string, title: string | null) {
        const target = session()
        const previous = get(id)

        if (!previous || title === previous.title || (title === null && previous.userTitle === null)) return

        // Only a new title is known before the server answers; a cleared one shows whatever the server falls back to.
        if (title !== null) replace(key, { ...previous, title, userTitle: title })

        await target.server.client.experimental.persistentPty
          .update({ ptyID: id, title })
          .then((info) => replace(key, info))
          .catch((error) => {
            // A newer title from the server stays.
            if (title !== null && get(id)?.userTitle === title) replace(key, previous)
            input.toast.show(
              isPtyFeatureUnsupportedError(error)
                ? { variant: "error", title: input.t("rename.unsupported") }
                : {
                    variant: "error",
                    title: input.t("rename.failed"),
                    description: error instanceof Error ? error.message : String(error),
                  },
            )
          })
      },
      requestFocus(id?: string) {
        requestFocus(key, id)
      },
      focusRequested,
      consumeFocus(id: string) {
        if (focusRequested(id)) setState("focus", undefined)
      },
      cancelFocus() {
        if (state.focus?.key === key) cancelFocus()
      },
    }
  }

  return {
    /** The server offers terminals. Servers that predate the capability count as offering them. */
    available,
    /** The session's terminals; the first load lists them from its server. */
    load(session: SessionRef) {
      sessions.set(session.key, session)
      watch(session.server)

      const existing = handles.get(session.key)

      if (existing) return existing

      const created = handle(session)

      handles.set(session.key, created)

      // Until the server's support is known, the check that reads it lists every loaded session.
      if (state.capabilities[session.server.id]) refreshQuietly(session)

      return created
    },
    ghostty() {
      if (ghostty.shared) return ghostty.shared

      ghostty.shared = importGhostty().catch((err) => {
        ghostty.shared = undefined
        throw err
      })

      return ghostty.shared
    },
    /** Forgets the terminal lists of a removed workspace's sessions. */
    remove(value: { readonly server: string; readonly directory: string }) {
      input.storage.remove(LEGACY.key, { scope: value, from: LEGACY.from })
      sessions.forEach((session, key) => {
        if (session.server.id !== value.server || session.location?.directory !== value.directory) return

        setLists((draft) => void delete draft.sessions[key])
        sessions.delete(key)
        handles.delete(key)
        selected.delete(key)
        sequence.delete(key)
      })
    },
    dispose() {
      watched.forEach((entry) => entry.stop())
      watched.clear()
      cleanups.forEach((cleanup) => cleanup())
    },
  }

  function dropLegacy(session: SessionRef) {
    const directory = session.location?.directory

    if (!directory) return

    const id = `${session.server.id}\0${directory}`

    if (cleared.has(id)) return

    cleared.add(id)
    input.storage.remove(LEGACY.key, { scope: { server: session.server.id, directory }, from: LEGACY.from })
  }
}

/** Resolves once the server has created the session. */
function settled(session: SessionRef, owner: Owner | null) {
  if (!session.pending) return Promise.resolve()

  return new Promise<void>((resolve) =>
    createRoot(
      (dispose) =>
        createKeyed(
          () => !session.pending,
          () => {
            dispose()
            resolve()
          },
        ),
      owner,
    ),
  )
}
