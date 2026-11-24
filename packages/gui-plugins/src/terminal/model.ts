import { createSignal, getOwner, runWithOwner, untrack } from "solid-js"
import { unwrap } from "solid-js/store"
import { Predicate, Schema } from "effect"
import {
  ClientError,
  isPtyFeatureUnsupportedError,
  isPtyNotFoundError,
  isServiceUnavailableError,
} from "@opencode/client"
import type { Layout, Persisted, ServerRef, SessionRef, Storage, Toasts } from "@opencode/plugin/gui"
import { createDispatch } from "./dispatch"
import { defaultTitle, titleNumber } from "./title"
import {
  initialState,
  serverAvailable,
  sessionConnection,
  sessionCreating,
  sessionView,
  TERMINAL_REQUEST_TIMEOUT_MS,
  transition,
  viewItems,
  viewTabs,
  type Command,
  type Event,
  type State,
} from "./machine"
import {
  focusRequestToken,
  hasFocusRequest,
  initialFocusState,
  isFocusRequested,
  transitionFocus,
  type FocusRequestEvent,
} from "./focus-machine"

// The keys terminals were stored under before they lived on the server. Their PTY ids no longer exist anywhere.
const LEGACY = { key: "terminals", from: "workspace:terminal" }

const Selected = Schema.Struct({ id: Schema.optional(Schema.String) })

export type TerminalModel = ReturnType<typeof createTerminalModel>

export type TerminalSession = ReturnType<TerminalModel["load"]>

const PANELS = "#terminal-panel, #review-panel"

const OVERLAYS = '[role="dialog"], [role="menu"]'

// How often a new terminal checks whether the server finished creating its session.
const SESSION_POLL_MS = 250

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

  const [focus, setFocus] = createSignal(initialFocusState)

  const sessions = new Map<string, SessionRef>()
  const handles = new Map<string, ReturnType<typeof handle>>()
  const selected = new Map<string, Persisted<typeof Selected.Type>>()
  const watched = new Map<string, { data: ServerRef["data"]; stop: VoidFunction }>()
  const cleared = new Set<string>()
  const cleanups: VoidFunction[] = []
  const ghostty: Ghostty = {}

  const serverState = (id: string) => machine.servers[id] ?? initialState

  // The live ref and driver loop of each server, and the requests in flight by attempt.
  const servers = new Map<string, { ref: ServerRef; dispatch: (event: Event) => void }>()
  const requests = new Map<string, Map<number, AbortController>>()
  // The new-terminal requests a session's create answers, and the focus request it resolves.

  const creates = new Map<
    string,
    { request: number; done: { promise: Promise<string | undefined>; resolve: (id: string | undefined) => void } }
  >()

  const dispatch = (server: ServerRef, event: Event) => {
    if (lifetime.signal.aborted) return
    const existing = servers.get(server.id)

    if (existing) {
      existing.ref = server
      existing.dispatch(event)

      return
    }

    const created = {
      ref: server,
      dispatch: createDispatch<State, Event, Command>({
        // Reads from reactive computations, such as `load`, must not subscribe them to every state change.
        read: () => untrack(() => unwrap(machine.servers[server.id])) ?? initialState,
        write: (state) => setMachine((draft) => void (draft.servers[server.id] = state)),
        transition: (state, next) => {
          const result = transition(state, next)

          return { state: result.state, effects: result.commands }
        },
        run: (command) => run(created.ref, command),
      }),
    }

    servers.set(server.id, created)
    created.dispatch(event)
  }

  /**
   * Runs one attempt's request under the request budget. A request the machine stopped waiting for answers nothing; one
   * that runs out of time fails, even when the server never ends it.
   */
  const request = <A>(
    server: ServerRef,
    attempt: number,
    call: (signal: AbortSignal) => Promise<A>,
    settle: { ok: (value: A) => Event; failed: (error: Error) => Event },
  ) => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, lifetime.signal])
    const timedOut = new Error(input.t("request.timedOut"))
    const timer = setTimeout(() => controller.abort(timedOut), TERMINAL_REQUEST_TIMEOUT_MS)
    const inflight = requests.get(server.id) ?? new Map<number, AbortController>()

    const ended = new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    )

    requests.set(server.id, inflight)
    inflight.set(attempt, controller)

    return Promise.race([call(signal), ended])
      .then(
        (value) => dispatch(server, settle.ok(value)),
        (cause: unknown) => {
          if (signal.aborted && signal.reason !== timedOut) return
          dispatch(server, settle.failed(cause instanceof Error ? cause : new Error(String(cause))))
        },
      )
      .finally(() => {
        clearTimeout(timer)
        inflight.delete(attempt)
      })
  }

  const run = (server: ServerRef, command: Command): Promise<void> | void => {
    if (command.type === "check-capability")
      return request(server, command.attempt, (signal) => server.client.server.info({ signal }), {
        // Servers that predate the field omit it; they still offer terminals.
        ok: (info) => ({
          type: "capability.checked",
          attempt: command.attempt,
          supported: info.capabilities?.persistentPty !== false,
        }),
        failed: (error) => {
          console.error("Failed to read server terminal support", error)

          return { type: "capability.failed", attempt: command.attempt, error: error.message }
        },
      })

    if (command.type === "load-list")
      return request(
        server,
        command.attempt,
        (signal) => server.client.experimental.persistentPty.list({ sessionID: command.sessionID }, { signal }),
        {
          ok: (items) => ({ type: "list.loaded", sessionID: command.sessionID, attempt: command.attempt, items }),
          failed: (error) => {
            if (isServiceUnavailableError(error))
              return { type: "list.unavailable", sessionID: command.sessionID, attempt: command.attempt }
            console.error("Failed to list terminals", error)

            return { type: "list.failed", sessionID: command.sessionID, attempt: command.attempt, error: error.message }
          },
        },
      )

    if (command.type === "create-terminal")
      return request(server, command.attempt, (signal) => createTerminal(server, command, signal), {
        ok: (terminal) => ({
          type: "create.succeeded",
          sessionID: command.sessionID,
          attempt: command.attempt,
          terminal,
        }),
        failed: (error) => ({
          type: "create.failed",
          sessionID: command.sessionID,
          attempt: command.attempt,
          kind: outdated(error) ? "unsupported" : "failed",
          error: error.message,
        }),
      })

    if (command.type === "close-terminal")
      return request(
        server,
        command.attempt,
        (signal) => server.client.experimental.persistentPty.remove({ ptyID: command.ptyID }, { signal }),
        {
          ok: () => ({
            type: "close.succeeded",
            sessionID: command.sessionID,
            ptyID: command.ptyID,
            attempt: command.attempt,
          }),
          // A terminal that already exited is closed.
          failed: (error) =>
            isPtyNotFoundError(error)
              ? {
                  type: "close.succeeded",
                  sessionID: command.sessionID,
                  ptyID: command.ptyID,
                  attempt: command.attempt,
                }
              : {
                  type: "close.failed",
                  sessionID: command.sessionID,
                  ptyID: command.ptyID,
                  attempt: command.attempt,
                  error: error.message,
                },
        },
      )

    if (command.type === "rename-terminal")
      return request(
        server,
        command.attempt,
        (signal) =>
          server.client.experimental.persistentPty.update({ ptyID: command.ptyID, title: command.title }, { signal }),
        {
          ok: (terminal) => ({
            type: "rename.succeeded",
            sessionID: command.sessionID,
            ptyID: command.ptyID,
            attempt: command.attempt,
            terminal,
          }),
          failed: (error) => ({
            type: "rename.failed",
            sessionID: command.sessionID,
            ptyID: command.ptyID,
            attempt: command.attempt,
            kind: isPtyFeatureUnsupportedError(error) ? "unsupported" : "failed",
            error: error.message,
          }),
        },
      )

    if (command.type === "abort") {
      command.attempts.forEach((attempt) => requests.get(server.id)?.get(attempt)?.abort())

      return
    }

    if (command.type === "settle-create") return settleCreate(server, command)

    if (command.type === "toast-close-failed") {
      input.toast.show({ variant: "error", title: input.t("close.failed"), description: command.error })

      return
    }

    if (command.type === "toast-rename-failed") {
      input.toast.show(
        command.kind === "unsupported"
          ? { variant: "error", title: input.t("rename.unsupported") }
          : { variant: "error", title: input.t("rename.failed"), description: command.error },
      )

      return
    }

    const session = sessions.get(`${server.id}\n${command.sessionID}`)

    if (!session) return
    dropLegacy(session)
    // The strip shows only stored tabs, so terminals another client created join it at the end.
    const stored = new Set(input.layout.stored(session))

    command.items.forEach((info) => {
      if (!stored.has(info.id)) input.layout.open(input.tab(info.id), session, { tab: "append" })
    })
  }

  const createTerminal = async (
    server: ServerRef,
    command: Extract<Command, { type: "create-terminal" }>,
    signal: AbortSignal,
  ) => {
    const target = sessions.get(`${server.id}\n${command.sessionID}`)

    if (!target) throw new Error(input.t("create.failed"))
    await settled(target, signal)

    // The next default title counts the terminals the server already has.
    const known =
      command.known ??
      (await server.client.experimental.persistentPty.list({ sessionID: target.id }, { signal }).catch(() => []))

    const used = new Set(known.flatMap((info) => titleNumber(info.title) ?? []))
    const number = Array.from({ length: used.size + 1 }, (_, index) => index + 1).find((n) => !used.has(n)) ?? 1

    return server.client.experimental.persistentPty.create(
      {
        sessionID: target.id,
        args: [],
        // A session that moved keeps its object; the server's record has the directory it runs in now.
        cwd: server.data.session.get(target.id)?.location.directory ?? target.location?.directory,
        title: defaultTitle(number),
        env: {},
      },
      { signal },
    )
  }

  /**
   * Resolves once the server has created the session: on its `session.created` event, or once `pending` clears. No
   * signal tracks `pending`, so it is checked again on an interval.
   */
  const settled = (session: SessionRef, signal: AbortSignal) => {
    if (!session.pending) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const end = () => {
        clearInterval(poll)
        stop()
        signal.removeEventListener("abort", abort)
      }

      const done = () => {
        end()
        resolve()
      }

      const abort = () => {
        end()
        reject(signal.reason)
      }

      const stop = runWithOwner(owner, () =>
        session.server.data.on("session.created", (event) => {
          if (event.data.sessionID === session.id) done()
        }),
      )!

      const poll = setInterval(() => {
        if (!session.pending) done()
      }, SESSION_POLL_MS)

      signal.addEventListener("abort", abort, { once: true })
    })
  }

  const settleCreate = (server: ServerRef, command: Extract<Command, { type: "settle-create" }>) => {
    const key = `${server.id}\n${command.sessionID}`
    const waiting = creates.get(key)
    creates.delete(key)

    if (command.outcome.ok) {
      const id = command.outcome.terminal.id
      const target = sessions.get(key)

      if (target) selection(target).set({ id })

      if (waiting) dispatchFocus({ type: "pending.resolved", request: waiting.request, id })
      waiting?.done.resolve(id)

      return
    }

    if (waiting) dispatchFocus({ type: "pending.failed", request: waiting.request })

    if (command.outcome.kind === "unsupported")
      input.toast.show({ variant: "error", title: input.t("create.unsupported") })

    if (command.outcome.kind === "failed")
      input.toast.show({ variant: "error", title: input.t("create.failed"), description: command.outcome.error })

    waiting?.done.resolve(undefined)
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
      data.on("server.connected", () => dispatch(server, { type: "server.connected" })),
      data.on("persistent-pty.added", (event) =>
        dispatch(server, { type: "session.refresh", sessionID: event.data.sessionID }),
      ),
      data.on("persistent-pty.removed", (event) =>
        dispatch(server, { type: "session.refresh", sessionID: event.data.sessionID }),
      ),
      data.on("persistent-pty.updated", (event) =>
        dispatch(server, {
          type: "terminal.updated",
          sessionID: event.data.sessionID,
          terminal: event.data.terminal,
        }),
      ),
    ])!

    watched.set(server.id, { data, stop: () => stops.forEach((stop) => stop()) })
    // Checks now rather than waiting for the stream: it may have connected already, and an answer a previous
    // instance was waiting for never arrives here.
    dispatch(server, { type: "server.connected" })
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

  const dispatchFocus = (event: FocusRequestEvent) => {
    const previous = untrack(focus)
    const next = transitionFocus(previous, event)

    if (next !== previous) setFocus(next)

    return next
  }

  // A request from a palette or menu pick starts while the overlay still holds focus.
  const overlay = () => typeof document !== "undefined" && inOverlay(document.activeElement)

  if (typeof document !== "undefined") {
    const moved = (event: FocusEvent) => {
      if (!hasFocusRequest(untrack(focus)) || !(event.target instanceof Element)) return
      const panel = event.target.closest(PANELS) !== null

      dispatchFocus({
        type: "focus.moved",
        into: !panel ? "outside" : event.target instanceof HTMLInputElement ? "field" : "panel",
        leavingOverlay: event.relatedTarget === null || inOverlay(event.relatedTarget),
      })
    }

    // A press where focus already is moves no focus, and still means the user moved on.
    const pressed = (event: PointerEvent) => {
      if (!hasFocusRequest(untrack(focus)) || !(event.target instanceof Element)) return

      if (event.target.closest(PANELS) || inOverlay(event.target)) return
      dispatchFocus({ type: "pointer.outside" })
    }

    // Capture phase: a tab's rename field stops its focusin from bubbling.
    document.addEventListener("focusin", moved, true)
    document.addEventListener("pointerdown", pressed, true)
    cleanups.push(() => {
      document.removeEventListener("focusin", moved, true)
      document.removeEventListener("pointerdown", pressed, true)
    })
  }

  const handle = (initial: SessionRef) => {
    const key = initial.key
    // A removed workspace forgets its session, while a component may still hold the handle.
    const session = () => sessions.get(key) ?? initial
    const view = () => sessionView(serverState(initial.server.id), initial.id)
    const all = () => viewItems(view())
    const get = (id: string) => all().find((info) => info.id === id)

    return {
      key,
      server: () => session().server,
      /** What the session's terminal panel shows: loading, failed, unsupported or the server's list. */
      view,
      /** The server connection whose answer the session's list is; a restarted server lists under a newer one. */
      connection: () => sessionConnection(serverState(initial.server.id), initial.id),
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
      /** A new terminal is being created; another request joins it. */
      creating: () => sessionCreating(serverState(initial.server.id), initial.id),
      /**
       * Creates a terminal and selects it; resolves its id, or undefined when the server refuses. A request while one
       * is being created joins it and resolves the same id.
       */
      new() {
        const target = session()
        const request = dispatchFocus({ type: "request.pending", session: key, overlay: overlay() }).request
        const done = creates.get(key)?.done ?? Promise.withResolvers<string | undefined>()

        // The create can answer before dispatch returns, so its waiter is registered first.
        creates.set(key, { request, done })
        dispatch(target.server, { type: "create.requested", sessionID: target.id })

        return done.promise
      },
      /** Removes the terminal on the server; its tab leaves once the server lists it no longer. */
      close(id: string) {
        dispatch(session().server, { type: "close.requested", sessionID: initial.id, ptyID: id })
      },
      /**
       * Sets the terminal's title on the server; `null` clears it, so the shell's or the default title shows again.
       * The title already shown, or clearing a terminal never renamed, sends nothing.
       */
      rename(id: string, title: string | null) {
        dispatch(session().server, { type: "rename.requested", sessionID: initial.id, ptyID: id, title })
      },
      requestFocus(id: string) {
        dispatchFocus({ type: "request.target", session: key, id, overlay: overlay() })
      },
      /** The terminal should take focus once it shows. */
      focusRequested: (id: string) => isFocusRequested(focus(), key, id),
      /** The request asking the terminal to take focus, so each focus attempt runs once per request. */
      focusRequest: (id: string) => focusRequestToken(focus(), key, id),
      consumeFocus(id: string) {
        dispatchFocus({ type: "consumed", session: key, id })
      },
      cancelFocus() {
        dispatchFocus({ type: "cancelled", session: key })
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
      dispatch(session.server, { type: "session.loaded", sessionID: session.id })

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
        dispatchFocus({ type: "cancelled", session: session.key })
      })

      const server = removed[0]?.server

      if (server) dispatch(server, { type: "sessions.removed", sessionIDs: removed.map((session) => session.id) })
    },
    dispose() {
      // Ends the changes in flight first, so a pending new-terminal request resolves and gives up its focus request.
      servers.forEach((entry) => dispatch(entry.ref, { type: "instance.stopped" }))
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

function inOverlay(node: EventTarget | null) {
  return node instanceof Element && node.closest(OVERLAYS) !== null
}

/** A server without the persistent terminal routes answers with a status its API never declares for them. */
function outdated(error: Error) {
  return (
    error instanceof ClientError &&
    error.reason === "UnexpectedStatus" &&
    Predicate.hasProperty(error.cause, "status") &&
    (error.cause.status === 404 || error.cause.status === 405)
  )
}
