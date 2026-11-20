import type { Browser } from "@opencode/plugin-browser/rpc"
import type { IpcClient } from "@opencode/plugin/gui"
import type { ExperimentalBrowserTab } from "@opencode/plugin/gui/browser"
import { uuid } from "@opencode/util/uuid"
import type { BrowserPane, FindAction, PaneEvent, PromptAnswer, Viewport } from "./ipc"

type Client = IpcClient<(typeof BrowserPane)["spec"]>

export type InspectEvent = Extract<PaneEvent, { type: "inspect" }>

export type PageEvent = Extract<PaneEvent, { type: "page" }>

export type ShortcutEvent = Extract<PaneEvent, { type: "shortcut" }>

export type Zoom = "in" | "out" | "reset"

export type Registration = {
  readonly binding: string
  /** Creates a restored tab's page, which then reports its embed. */
  load(tabID: Browser.TabID): void
  command(command: Browser.Action): Promise<void>
  createTab(owner: string, url: string, onScreen: () => boolean): Promise<ExperimentalBrowserTab>
  closeTab(owner: string, id: ExperimentalBrowserTab): Promise<boolean>
  inspect(tabID: Browser.TabID, enabled: boolean): void
  highlight(tabID: Browser.TabID, ref?: Browser.Ref): void
  zoom(tabID: Browser.TabID, zoom: Zoom): void
  find(tabID: Browser.TabID, action: FindAction): Promise<void>
  notice(tabID: Browser.TabID, token: string, dismiss: boolean, copy?: boolean): Promise<void>
  reviewLink(url: string): Promise<Browser.TabID>
  answer(tabID: Browser.TabID, id: number, answer: PromptAnswer): Promise<void>
  setViewport(tabID: Browser.TabID, viewport: Viewport): Promise<void>
  site(tabID: Browser.TabID): Promise<{ cookies: number }>
  clearSite(tabID: Browser.TabID): Promise<void>
  clearCache(tabID: Browser.TabID, address: string): Promise<void>
  reveal(tabID: Browser.TabID): Promise<void>
  openPage(tabID: Browser.TabID, expected: string): Promise<void>
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
    binding,
    load(tabID) {
      if (status.closed) return
      void ready.then(() => client.load({ binding, tabID })).catch(() => undefined)
    },
    command: (command) => ready.then(() => client.command({ binding, command })),
    closeTab: (owner, id) => ready.then(() => client.closeTab({ binding, owner, id })),
    async createTab(owner, url, onScreen) {
      if (!onScreen()) throw new Error("browser.pane.notOnScreen")
      await ready

      if (status.closed || !onScreen()) throw new Error("browser.pane.notOnScreen")

      return client.createTab({ binding, owner, url })
    },
    find: (tabID, action) => ready.then(() => client.find({ binding, tabID, action })),
    notice: (tabID, token, dismiss, copy) => ready.then(() => client.notice({ binding, tabID, token, dismiss, copy })),
    reviewLink: (url) => ready.then(() => client.reviewLink({ binding, url })),
    answer: (tabID, id, answer) => ready.then(() => client.answer({ binding, tabID, id, answer })),
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
    setViewport: (tabID, viewport) => ready.then(() => client.setViewport({ binding, tabID, viewport })),
    site: (tabID) => ready.then(() => client.site({ binding, tabID })),
    clearSite: (tabID) => ready.then(() => client.clearSite({ binding, tabID })),
    clearCache: (tabID, address) => ready.then(() => client.clearCache({ binding, tabID, address })),
    reveal: (tabID) => ready.then(() => client.reveal({ binding, tabID })),
    openPage: (tabID, expected) => ready.then(() => client.openPage({ binding, tabID, expected })),
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
