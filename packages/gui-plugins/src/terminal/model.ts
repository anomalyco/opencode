import { createRoot, getOwner, runWithOwner, untrack, type Owner } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
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
import {
  initialState,
  serverAvailable,
  sessionView,
  transition,
  viewItems,
  viewTabs,
  type Command,
  type Event,
  type State,
} from "./machine"

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
 * stored. Each server's support and lists follow the machine in `./machine`; this runs its requests.
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
  const lifetime = new AbortController()

  // Survives plugin reloads, so restored terminals show at once; the first watch checks every server again.
  const [machine, setMachine] = input.storage.memory<{ servers: Record<string, State> }>("servers", {
    initial: { servers: {} },
  })

  const [state, setState] = createStore<{ focus?: FocusRequest }>({})

  const sessions = new Map<string, SessionRef>()
  const handles = new Map<string, ReturnType<typeof handle>>()
  const selected = new Map<string, Persisted<typeof Selected.Type>>()
  const watched = new Map<string, { data: ServerRef["data"]; stop: VoidFunction }>()
  const cleared = new Set<string>()
  const cleanups: VoidFunction[] = []
  const ghostty: Ghostty = {}
  const focus = { request: 0 }

  const serverState = (id: string) => machine.servers[id] ?? initialState

  /** Resolves once the requests the event started have answered and their answers were dispatched. */
  const dispatch = (server: ServerRef, event: Event): Promise<void> => {
    if (lifetime.signal.aborted) return Promise.resolve()
    // Reads from reactive computations, such as `load`, must not subscribe them to every state change.
    const previous = untrack(() => unwrap(machine.servers[server.id])) ?? initialState
    const next = transition(previous, event)

    if (next.state !== previous) setMachine((draft) => void (draft.servers[server.id] = next.state))

    return Promise.all(next.commands.map((command) => run(server, command))).then(() => undefined)
  }

  const run = (server: ServerRef, command: Command): Promise<void> => {
    if (command.type === "check-capability")
      return server.client.server.info().then(
        // Servers that predate the field omit it; they still offer terminals.
        (info) =>
          dispatch(server, {
            type: "capability.checked",
            attempt: command.attempt,
            supported: info.capabilities?.persistentPty !== false,
          }),
        (error) => {
          console.error("Failed to read server terminal support", error)

          return dispatch(server, {
            type: "capability.failed",
            attempt: command.attempt,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      )

    if (command.type === "load-list")
      return server.client.experimental.persistentPty.list({ sessionID: command.sessionID }).then(
        (items) =>
          dispatch(server, { type: "list.loaded", sessionID: command.sessionID, attempt: command.attempt, items }),
        (error) => {
          if (isServiceUnavailableError(error))
            return dispatch(server, {
              type: "list.unavailable",
              sessionID: command.sessionID,
              attempt: command.attempt,
            })
          console.error("Failed to list terminals", error)

          return dispatch(server, {
            type: "list.failed",
            sessionID: command.sessionID,
            attempt: command.attempt,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      )

    const session = sessions.get(`${server.id}\n${command.sessionID}`)

    if (!session) return Promise.resolve()
    dropLegacy(session)
    // The strip shows only stored tabs, so terminals another client created join it at the end.
    const stored = new Set(input.layout.stored(session))

    command.items.forEach((info) => {
      if (!stored.has(info.id)) input.layout.open(input.tab(info.id), session, { tab: "append" })
    })

    return Promise.resolve()
  }

  const available = (server: ServerRef) => {
    watch(server)

    return serverAvailable(serverState(server.id))
  }

  // A restarted server replaces its data under the same ref, so reads that track `server.data` subscribe again.
  const watch = (server: ServerRef) => {
    const data = server.data
    const current = watched.get(server.id)

    if (current?.data === data) return
    current?.stop()

    // Subscriptions end with the owner they start under, and this runs from whichever computation first read the
    // server, so they belong to the model.
    const stops = runWithOwner(owner, () => [
      // The event stream opens with server.connected, so this runs for the first connection and every reconnect.
      data.on("server.connected", () => void dispatch(server, { type: "server.connected" })),
      data.on(
        "persistent-pty.added",
        (event) => void dispatch(server, { type: "session.refresh", sessionID: event.data.sessionID }),
      ),
      data.on(
        "persistent-pty.removed",
        (event) => void dispatch(server, { type: "session.refresh", sessionID: event.data.sessionID }),
      ),
      data.on(
        "persistent-pty.updated",
        (event) =>
          void dispatch(server, {
            type: "terminal.updated",
            sessionID: event.data.sessionID,
            terminal: event.data.terminal,
          }),
      ),
    ])!

    watched.set(server.id, { data, stop: () => stops.forEach((stop) => stop()) })
    // Checks now rather than waiting for the stream: it may have connected already, and an answer a previous
    // instance was waiting for never arrives here.
    void dispatch(server, { type: "server.connected" })
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
    const view = () => sessionView(serverState(initial.server.id), initial.id)
    const all = () => viewItems(view())
    const get = (id: string) => all().find((info) => info.id === id)

    const focusRequested = (id?: string) => {
      if (!id || !state.focus || state.focus.pending || state.focus.key !== key) return false

      return !state.focus.id || state.focus.id === id
    }

    return {
      key,
      server: () => session().server,
      /** What the session's terminal panel shows: loading, failed, unsupported or the server's list. */
      view,
      /** The session's terminals, in the server's order. */
      all,
      get,
      /** The strip's tab ids for the stored `open` ones. */
      tabs: (open: readonly string[]) => viewTabs(view(), open),
      /** Loads the session's terminals again after a failure. */
      retry: () => dispatch(session().server, { type: "session.retry", sessionID: initial.id }),
      /** The selected terminal, else the first one. */
      active() {
        const id = selection(session()).value?.id

        return id && get(id) ? id : all()[0]?.id
      },
      select(id: string) {
        selection(session()).set({ id })
      },
      /** Creates a terminal and selects it; resolves its id, or undefined when the server refuses. */
      async new() {
        const target = session()
        const request = requestFocus(key, undefined, true)

        await settled(target, owner)

        // The next default title counts the terminals the server already has.
        const known =
          view().type === "ready"
            ? all()
            : await target.server.client.experimental.persistentPty.list({ sessionID: target.id }).catch(() => all())

        const used = new Set(known.flatMap((info) => titleNumber(info.title) ?? []))
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

        await dispatch(target.server, { type: "session.refresh", sessionID: target.id })
        selection(target).set({ id: info.id })

        if (state.focus?.request === request) setState("focus", { key, request, id: info.id, pending: false })

        return info.id
      },
      /** Removes the terminal on the server; its tab leaves once the server lists it no longer. */
      async close(id: string) {
        const target = session()

        await target.server.client.experimental.persistentPty
          .remove({ ptyID: id })
          .then(() => dispatch(target.server, { type: "session.refresh", sessionID: target.id }))
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

        const replace = (terminal: PersistentPtyInfo) =>
          void dispatch(target.server, { type: "terminal.replaced", sessionID: target.id, terminal })

        // Only a new title is known before the server answers; a cleared one shows whatever the server falls back to.
        if (title !== null) replace({ ...previous, title, userTitle: title })

        await target.server.client.experimental.persistentPty
          .update({ ptyID: id, title })
          .then(replace)
          .catch((error) => {
            // A newer title from the server stays.
            if (title !== null && get(id)?.userTitle === title) replace(previous)
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
      void dispatch(session.server, { type: "session.loaded", sessionID: session.id })

      const existing = handles.get(session.key)

      if (existing) return existing

      const created = handle(session)

      handles.set(session.key, created)

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

      const removed = [...sessions.values()].filter(
        (session) => session.server.id === value.server && session.location?.directory === value.directory,
      )

      removed.forEach((session) => {
        sessions.delete(session.key)
        handles.delete(session.key)
        selected.delete(session.key)
      })

      const server = removed[0]?.server

      if (server) void dispatch(server, { type: "sessions.removed", sessionIDs: removed.map((session) => session.id) })
    },
    dispose() {
      lifetime.abort()
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
