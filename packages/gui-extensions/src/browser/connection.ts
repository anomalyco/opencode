import type { Browser } from "@opencode/plugin-browser/rpc"
import type { RemoteClient } from "../sdk"
import type { BrowserPane, PaneEvent } from "./remote"

type Client = RemoteClient<(typeof BrowserPane)["spec"]>
export type InspectEvent = Extract<PaneEvent, { type: "inspect" }>
export type Connection = ReturnType<typeof createConnection>

export type Registration = {
  /** Creates a restored tab's page, which then reports its surface. */
  load(tabID: Browser.TabID): void
  command(command: Browser.Action): Promise<void>
  inspect(tabID: Browser.TabID, enabled: boolean): void
  highlight(tabID: Browser.TabID, ref?: Browser.Ref): void
  close(): void
}

type ConnectionState = {
  registration?: Registration
  browser: Browser.State | null
  /** Host surface per tab page of the current registration. */
  surfaces: Readonly<Record<string, string>>
  suspended: boolean
  error?: string
}
// Owns native registration, retry, and suspended tab metadata independently of the mounted session route, and
// mirrors the desktop's tabs into the session's strip.
export function createConnection(input: {
  client: () => Client | undefined
  listen: (binding: string, listener: (event: PaneEvent) => void) => () => void
  target: () => { server: string; session: string }
  /** `mirror` applies the state's tabs to the strip; call it right after storing the state, in the same batch. */
  change: (state: ConnectionState, mirror: () => void) => void
  /** The session's strip: the browser tab IDs it stores, and quietly adding or removing one. */
  strip: {
    stored: () => readonly string[]
    open: (tabID: Browser.TabID) => void
    close: (tabID: string) => void
  }
  focus: (tabID: Browser.TabID) => void
  preview: (path: string) => void
  inspect: (event: InspectEvent) => void
}) {
  const state: ConnectionState = { browser: null, surfaces: {}, suspended: false }
  let disposed = false
  let blocked = false
  let attempts = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  // A registration was wanted while the pane's remote was gone; it registers once the remote is back.
  let lost = false
  // Tab IDs of the last inventory, to tell new tabs from ones the user just closed.
  let known: readonly Browser.TabID[] | undefined
  // Reports the state with a mirror of its tabs into the strip, applied after the state so closing a strip tab already
  // finds the desktop's answer. Only tabs new since the last inventory are added, so a tab the user just closed is not
  // reopened before the desktop confirms. Only a native inventory removes: it closes every stored tab it lacks, so the
  // desktop decides which tabs exist, while suspended, unavailable, and restoring states keep the tabs they will restore.
  const publish = (native = false) => {
    const previous = new Set<string>(known ?? [])
    const ids = state.browser?.tabs.map((tab) => tab.id)
    known = ids
    input.change({ ...state }, () => {
      if (!ids) return
      if (native) {
        const listed = new Set<string>(ids)
        input.strip
          .stored()
          .filter((tabID) => !listed.has(tabID))
          .forEach((tabID) => input.strip.close(tabID))
      }
      ids.forEach((tabID) => {
        if (!previous.has(tabID)) input.strip.open(tabID)
      })
    })
  }
  // The pane itself is unreachable while its main extension restarts or is disabled, and main drops every
  // binding without reporting it. Keep the tabs, like an idle eviction, and register again when it returns.
  const suspend = (registration: Registration) => {
    if (disposed || state.registration !== registration) return
    lost = true
    registration.close()
    state.registration = undefined
    state.surfaces = {}
    state.suspended = true
    state.error = undefined
    publish()
  }
  // Main closed the binding, or never took it (an SSH server's endpoint is missing while it reconnects).
  // Keep the tabs and register again with backoff; commands sent through it already failed and are not replayed.
  const reopen = (registration: Registration) => {
    if (disposed || state.registration !== registration) return
    registration.close()
    state.registration = undefined
    state.surfaces = {}
    state.suspended = false
    state.error = undefined
    publish()
    retry = setTimeout(register, Math.min(30_000, 1_000 * 2 ** attempts++))
  }
  const register = () => {
    if (disposed || blocked || state.registration) return
    const current = input.client()
    if (!current) {
      lost = true
      return
    }
    lost = false
    clearTimeout(retry)
    const registration: Registration = open(
      current,
      input.listen,
      { ...input.target(), ...(state.browser ? { restore: state.browser } : {}) },
      (event) => {
        if (disposed || state.registration !== registration) return
        if (event.type === "focus") return input.focus(event.tabID)
        if (event.type === "preview") return input.preview(event.path)
        if (event.type === "inspect") return input.inspect(event)
        if (event.type === "surface") {
          state.surfaces = { ...state.surfaces, [event.tabID]: event.surface }
          return publish()
        }
        if (event.error === "browser.pane.unsupported" || event.error === "browser.pane.replaced") {
          blocked = true
          registration.close()
          state.registration = undefined
          state.surfaces = {}
          state.browser = null
          state.error = event.error
          publish()
          return
        }
        if (event.error === "browser.pane.registration.closed") return reopen(registration)
        if (event.error === "browser.pane.suspended") {
          registration.close()
          state.registration = undefined
          state.surfaces = {}
          state.suspended = true
          if (event.state) state.browser = event.state
          state.error = undefined
          publish()
          // Idle eviction has no retry timer. A user or Session execution wakes it on demand.
          return
        }
        if (event.state) attempts = 0
        state.browser = event.state
        state.error = event.error
        publish(true)
      },
      (error) => (unavailable(error) ? suspend(registration) : reopen(registration)),
    )
    state.registration = registration
    state.surfaces = {}
    state.suspended = false
    state.error = undefined
    publish()
  }
  return {
    wake: register,
    /** Follows the pane's remote going away and coming back. */
    refresh() {
      if (!input.client()) {
        if (state.registration) suspend(state.registration)
        return
      }
      if (lost) register()
    },
    command(command: Browser.Action) {
      register()
      const registration = state.registration
      if (!registration) {
        const error = new Error("browser.pane.unavailable")
        return Promise.reject(input.client() ? error : Object.assign(error, { code: "unavailable" }))
      }
      return registration.command(command).catch((error: unknown) => {
        if (unavailable(error)) suspend(registration)
        throw error
      })
    },
    inspect(tabID: Browser.TabID, enabled: boolean) {
      state.registration?.inspect(tabID, enabled)
    },
    highlight(tabID: Browser.TabID, ref?: Browser.Ref) {
      state.registration?.highlight(tabID, ref)
    },
    dispose() {
      disposed = true
      clearTimeout(retry)
      state.registration?.close()
      state.registration = undefined
    },
  }
}

function open(
  client: Client,
  listen: (binding: string, listener: (event: PaneEvent) => void) => () => void,
  target: { server: string; session: string; restore?: Browser.State },
  listener: (event: PaneEvent) => void,
  failed: (error: unknown) => void,
): Registration {
  const binding = crypto.randomUUID()
  const status = { closed: false }
  const stop = listen(binding, (event) => {
    if (!status.closed) listener(event)
  })
  const ready = client.register({ binding, ...target })
  // Other failures reach the owner through the closed-state event; keep the bare promise handled.
  void ready.catch(failed)
  return {
    load(tabID) {
      if (status.closed) return
      void ready.then(() => client.load({ binding, tabID })).catch(() => undefined)
    },
    command: (command) => ready.then(() => client.command({ binding, command })),
    inspect(tabID, enabled) {
      if (status.closed) return
      void ready.then(() => client.inspect({ binding, tabID, enabled })).catch(() => undefined)
    },
    highlight(tabID, ref) {
      if (status.closed) return
      void ready
        .then(() => client.highlight({ binding, tabID, ...(ref === undefined ? {} : { ref }) }))
        .catch(() => undefined)
    },
    close() {
      if (status.closed) return
      status.closed = true
      stop()
      void ready.then(() => client.close({ binding })).catch(() => undefined)
    },
  }
}

// The bridge rejects with code "unavailable" while the pane's main extension is not running.
export function unavailable(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "unavailable"
}
