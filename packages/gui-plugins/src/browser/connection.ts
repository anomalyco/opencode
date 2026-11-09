import type { Browser } from "@opencode/plugin-browser/rpc"
import type { IpcClient } from "@opencode/plugin/gui"
import { uuid } from "@opencode/util/uuid"
import type { BrowserPane, PaneEvent } from "./ipc"

type Client = IpcClient<(typeof BrowserPane)["spec"]>

export type InspectEvent = Extract<PaneEvent, { type: "inspect" }>

export type PageEvent = Extract<PaneEvent, { type: "page" }>

export type ShortcutEvent = Extract<PaneEvent, { type: "shortcut" }>

export type Zoom = "in" | "out" | "reset"

export type Registration = {
  /** Creates a restored tab's page, which then reports its embed. */
  load(tabID: Browser.TabID): void
  command(command: Browser.Action): Promise<void>
  inspect(tabID: Browser.TabID, enabled: boolean): void
  highlight(tabID: Browser.TabID, ref?: Browser.Ref): void
  zoom(tabID: Browser.TabID, zoom: Zoom): void
  site(tabID: Browser.TabID): Promise<{ cookies: number }>
  clearSite(tabID: Browser.TabID): Promise<void>
  close(): void
}

// One binding of a session's pane with main. It holds no lifecycle state: the model's machine decides what each
// answer means. Nothing reaches the callbacks once the binding is closed.
export function openBinding(input: {
  client: Client
  listen: (binding: string, listener: (event: PaneEvent) => void) => () => void
  target: { server: string; session: string; restore?: Browser.State }
  /** Main took the binding. */
  accepted: () => void
  /** Main refused or closed the binding, or the Ipc could not answer. */
  failed: (cause: unknown) => void
  listener: (event: PaneEvent) => void
}): Registration {
  const client = input.client
  const binding = uuid()
  const status = { closed: false }

  const stop = input.listen(binding, (event) => {
    if (!status.closed) input.listener(event)
  })

  const ready = client.register({ binding, ...input.target })
  void ready.then(
    () => {
      if (!status.closed) input.accepted()
    },
    (cause: unknown) => {
      if (!status.closed) input.failed(cause)
    },
  )

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
    zoom(tabID, zoom) {
      if (status.closed) return
      void ready.then(() => client.zoom({ binding, tabID, zoom })).catch(() => undefined)
    },
    site: (tabID) => ready.then(() => client.site({ binding, tabID })),
    clearSite: (tabID) => ready.then(() => client.clearSite({ binding, tabID })),
    close() {
      if (status.closed) return
      status.closed = true
      stop()
      void ready.then(() => client.close({ binding })).catch(() => undefined)
    },
  }
}

// The bridge rejects with code "unavailable" while the pane's main plugin is not running.
export function unavailable(cause: unknown) {
  return cause instanceof Error && "code" in cause && cause.code === "unavailable"
}
