import type { Browser } from "@opencode/plugin-browser/rpc"
import type { IpcClient } from "../sdk"
import type { BrowserPane, PaneEvent } from "./ipc"

type Client = IpcClient<(typeof BrowserPane)["spec"]>

export type InspectEvent = Extract<PaneEvent, { type: "inspect" }>

export type Connection = ReturnType<typeof createConnection>

export type Registration = {
  /** Creates a restored tab's page, which then reports its embed. */
  load(tabID: Browser.TabID): void
  command(command: Browser.Action): Promise<void>
  inspect(tabID: Browser.TabID, enabled: boolean): void
  highlight(tabID: Browser.TabID, ref?: Browser.Ref): void
  close(): void
}

type ConnectionState = {
  registration?: Registration
  browser: Browser.State | null
  /** Host embed per tab page of the current registration. */
  embeds: Readonly<Record<string, string>>
  suspended: boolean
  error?: string
}

// Owns native registration, retry, and suspended tab metadata independently of the mounted session route, and
// mirrors the desktop's tabs into the session's strip.
export function createConnection(input: {
  client: () => Client | undefined
  listen: (binding: string, listener: (event: PaneEvent) => void) => () => void
  target: () => { server: string; session: string }
  /**
   * `mirror` applies the current tabs to the strip; call it right after storing the state, in the same batch, or
   * later once the strip can be written. A mirror that never runs leaves the strip's tabs as they are.
   */
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
  const state: ConnectionState = { browser: null, embeds: {}, suspended: false }
  let disposed = false
  let blocked = false
  let attempts = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  // A registration was wanted while the pane's Ipc was gone; it registers once the Ipc is back.
  let lost = false
  // Tab IDs of the last inventory the strip received, to tell new tabs from ones the user just closed.
  let known: readonly Browser.TabID[] | undefined
  // A native inventory the strip has not received yet; the next mirror that runs prunes with it.
  let pruning = false

  // Mirrors the tabs into the strip, applied after the state so closing a strip tab already finds the desktop's answer.
  // Only tabs new since the last mirrored inventory are added, so a tab the user just closed is not reopened before
  // the desktop confirms. Only a native inventory removes: it closes every stored tab it lacks, so the desktop decides
  // which tabs exist, while suspended, unavailable, and restoring states keep the tabs they will restore.
  const mirror = () => {
    const previous = new Set<string>(known ?? [])
    const ids = state.browser?.tabs.map((tab) => tab.id)
    const prune = pruning
    known = ids
    pruning = false

    if (!ids) return

    if (prune) {
      const listed = new Set<string>(ids)
      input.strip
        .stored()
        .filter((tabID) => !listed.has(tabID))
        .forEach((tabID) => input.strip.close(tabID))
    }

    ids.forEach((tabID) => {
      if (!previous.has(tabID)) input.strip.open(tabID)
    })
  }

  const publish = (native = false) => {
    pruning ||= native
    input.change({ ...state }, mirror)
  }

  // The pane itself is unreachable while its main extension restarts or is disabled, and main drops every
  // binding without reporting it. Keep the tabs, like an idle eviction, and register again when it returns.
  const suspend = (registration: Registration) => {
    if (disposed || state.registration !== registration) return
    lost = true
    registration.close()
    state.registration = undefined
    state.embeds = {}
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
    state.embeds = {}
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
      state.browser ? { ...input.target(), restore: state.browser } : input.target(),
      (event) => {
        if (disposed || state.registration !== registration) return

        if (event.type === "focus") return input.focus(event.tabID)

        if (event.type === "preview") return input.preview(event.path)

        if (event.type === "inspect") return input.inspect(event)

        if (event.type === "embed") {
          state.embeds = { ...state.embeds, [event.tabID]: event.embed }

          return publish()
        }

        if (event.error === "browser.pane.unsupported" || event.error === "browser.pane.replaced") {
          blocked = true
          registration.close()
          state.registration = undefined
          state.embeds = {}
          state.browser = null
          state.error = event.error
          publish()

          return
        }

        if (event.error === "browser.pane.registration.closed") return reopen(registration)

        if (event.error === "browser.pane.suspended") {
          registration.close()
          state.registration = undefined
          state.embeds = {}
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
      (error) => {
        if (unavailable(error)) return suspend(registration)

        // Main closed a binding it took; its closed-state event decides, whichever of the two arrives first.
        if (error instanceof Error && error.message === "browser.pane.registration.closed") return
        reopen(registration)
      },
    )

    state.registration = registration
    state.embeds = {}
    state.suspended = false
    state.error = undefined
    publish()
  }

  return {
    wake: register,
    /** Follows the pane's Ipc going away and coming back. */
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

      return registration.command(command).catch((cause: unknown) => {
        if (unavailable(cause)) suspend(registration)
        throw cause
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
  failed: (cause: unknown) => void,
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
        .then(() => client.highlight(ref === undefined ? { binding, tabID } : { binding, tabID, ref }))
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
export function unavailable(cause: unknown) {
  return cause instanceof Error && "code" in cause && cause.code === "unavailable"
}
