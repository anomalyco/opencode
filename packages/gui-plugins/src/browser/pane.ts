import { connectClientMcp, type ClientMcpConnection } from "@opencode/client/mcp"
import { OpenCode } from "@opencode/client/promise"
import electron, { type BrowserWindow } from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds, Persisted, ServerEndpoint, ServerEndpoints, Windows } from "@opencode/plugin/gui/main"
import { createBrowserPage, type BrowserPage, type Shared } from "./chromium"
import { browserTools, instructions } from "./mcp"
import { createBrowserNetwork, type BrowserNetwork } from "./network"
import { Browser } from "./operations"
import { destinationOrigin, fileURLWithin, refusal } from "./policy"
import { createRefs } from "./refs"
import type { PaneEvent } from "./ipc"
import { createBrowserRestoreStore } from "./restore"

type Target = { readonly server: string; readonly session: string; readonly restore?: Browser.State }

type Entry = {
  binding: string
  window: number
  win: BrowserWindow
  server: ServerEndpoint
  sessionID: string
  abort: AbortController
  /** The key of the tools that serve this pane's session; unset until registration finishes and after it closes. */
  served?: string
  /** The agent's operations still running, so closing a tab or the pane can abort them. */
  requests: Set<{ abort: AbortController; tabID?: Browser.TabID }>
  cleanup?: () => void
  pages: Map<Browser.TabID, BrowserPage>
  tabs: Map<Browser.TabID, Browser.Tab>
  focusedTabID: Browser.TabID | null
  partition: string
  lastState?: string
  network?: BrowserNetwork
  storageKey: string
  /**
   * Workspace directories whose files may load as file:// documents. Set only for the desktop's
   * own sidecar: a forwarded or explicit loopback server does not share this machine's disk.
   */
  fileRoots: string[]
}

/** One client MCP connection per server and directory; it routes each call to the pane showing the calling session. */
type Tools = { connection: ClientMcpConnection; entries: Set<Entry> }

export type Pane = ReturnType<typeof createBrowserPane>

export function createBrowserPane(input: {
  readonly windows: Windows
  readonly serverEndpoints: ServerEndpoints
  readonly storage: BuiltinMainStorage
  /** The declared store of reserved element refs. */
  readonly refs: Persisted<number, number>
  readonly embeds: Embeds
  readonly emit: (window: number, value: { readonly binding: string; readonly event: PaneEvent }) => void
}) {
  const entries = new Map<string, Entry>()
  const tools = new Map<string, Tools>()
  const restore = createBrowserRestoreStore(input.storage)
  const shared: Shared = { ref: createRefs(input.refs) }
  // Page disposals in flight. Finishing a trace or CPU profile can hold a page open, and the pane's own disposal waits
  // for them so a replacement never starts beside old pages still recording.
  const releasing = new Set<Promise<void>>()
  let disposed = false

  return {
    async register(window: number, binding: string, target: Target) {
      const server = input.serverEndpoints.get(target.server)

      if (disposed || !server || !destinationOrigin(server.url)) throw new Error("browser.pane.registration.invalid")

      const win = input.windows.get(window)

      if (!win || entries.has(binding)) throw new Error("browser.pane.owner.invalid")

      if (win.isDestroyed() || win.webContents.isDestroyed()) throw new Error("browser.pane.owner.unavailable")
      const storageKey = `${target.server}\n${target.session}`
      const saved = restore.load(storageKey)

      const previous = target.restore ?? {
        tabs: saved.tabs.map((tab) => ({
          ...tab,
          title: "",
          generation: 0,
        })),
        focusedTabID: saved.focusedTabID,
      }

      const entry: Entry = {
        binding,
        window,
        win,
        server,
        sessionID: target.session,
        abort: new AbortController(),
        requests: new Set(),
        pages: new Map(),
        tabs: new Map(
          previous.tabs.map((tab) => [
            tab.id,
            {
              ...tab,
              loading: false,
              canGoBack: false,
              canGoForward: false,
              generation: tab.generation + 1,
            },
          ]),
        ),
        focusedTabID: previous.focusedTabID,
        partition: `opencode-browser-${crypto.randomUUID()}`,
        storageKey,
        fileRoots: [],
      }

      // Navigation guards cover documents; subresources (img, script, fetch) also must not read
      // file: URLs outside the roots. One listener per partition covers every page in this pane.
      electron.session
        .fromPartition(entry.partition)
        .webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) =>
          callback({ cancel: !fileURLWithin(details.url, entry.fileRoots) }),
        )
      const stop = () => close(entry)

      const navigate = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (event.isMainFrame && !event.isSameDocument) stop()
      }

      win.webContents.once("destroyed", stop)
      win.webContents.on("did-start-navigation", navigate)
      entry.cleanup = () => {
        if (win.isDestroyed()) return
        win.webContents.off("destroyed", stop)
        win.webContents.off("did-start-navigation", navigate)
      }

      entries.set(binding, entry)

      // Node requests bypass the webRequest header injection, so main sends the credential the host resolved for it;
      // the renderer never holds the managed sidecar's password.
      const session = await OpenCode.make({ baseUrl: server.url, headers: server.headers })
        .session.get({ sessionID: target.session }, { signal: entry.abort.signal })
        .catch((cause: unknown) => {
          if (entries.get(binding) !== entry) throw new Error("browser.pane.registration.closed")
          stop()
          throw cause
        })

      if (entries.get(binding) !== entry) throw new Error("browser.pane.registration.closed")

      // The agent can already read this workspace, so showing its files adds no access.
      if (server.sameMachine) entry.fileRoots = [session.location.directory]
      entry.network = createBrowserNetwork(entry.partition)
      // A pane for the same session in another window takes over its tools, so calls never reach a stale pane.
      entries.forEach((other) => {
        if (other.served && other.storageKey === storageKey) close(other, "browser.pane.replaced")
      })
      serve(entry, session.location.directory)
      publishState(entry)
    },
    load(window: number, binding: string, tabID: Browser.TabID) {
      load(owned(window, binding), tabID)
    },
    async inspect(window: number, binding: string, tabID: Browser.TabID, enabled: boolean) {
      await owned(window, binding).pages.get(tabID)?.inspect(enabled)
    },
    async highlight(window: number, binding: string, tabID: Browser.TabID, ref?: Browser.Ref) {
      await owned(window, binding).pages.get(tabID)?.highlight(ref)
    },
    zoom(window: number, binding: string, tabID: Browser.TabID, direction: "in" | "out" | "reset") {
      owned(window, binding).pages.get(tabID)?.zoom(direction)
    },
    async site(window: number, binding: string, tabID: Browser.TabID) {
      return (await owned(window, binding).pages.get(tabID)?.site()) ?? { cookies: 0 }
    },
    async clearSite(window: number, binding: string, tabID: Browser.TabID) {
      await owned(window, binding).pages.get(tabID)?.clearSite()
    },
    async command(window: number, binding: string, command: Browser.Action) {
      const entry = owned(window, binding)
      const url = command.type === "navigate" || command.type === "tabs.open" ? command.url : undefined
      // The window explains a refused address by its code; the agent's commands get main's own message instead.
      const reason = url === undefined ? undefined : refusal(url, { fileRoots: entry.fileRoots })

      if (reason) throw new Error(reason)
      // A navigation that the next one replaced, such as a second submit or a redirect, rejects with ERR_ABORTED while
      // the tab goes on loading. It is not a failed request; a page that fails to load reports its own error.
      await execute(entry, { action: command, files: [] }, new AbortController().signal).catch((error: Error) => {
        if (!("code" in error) || error.code !== "ERR_ABORTED") throw error
      })
    },
    async close(window: number, binding: string) {
      const entry = owned(window, binding)
      restore.remove(entry.storageKey)
      close(entry)
    },
    /**
     * The plugin is going away (reload, disable, or quit). Windows keep each pane's tabs as a
     * suspended attachment, like an idle server eviction, and register again once the pane is back.
     */
    async dispose() {
      disposed = true
      entries.forEach((entry) => close(entry, "browser.pane.suspended"))
      await Promise.all(releasing)
    },
  }

  /** Serves the pane's session through the browser tools of its server and directory, connecting them on first use. */
  function serve(entry: Entry, directory: string) {
    const key = JSON.stringify([entry.server.id, directory])
    entry.served = key
    const existing = tools.get(key)

    if (existing) return void existing.entries.add(entry)
    const served = new Set([entry])
    const client = OpenCode.make({ baseUrl: entry.server.url, headers: entry.server.headers })
    tools.set(key, {
      entries: served,
      connection: connectClientMcp({
        url: entry.server.url,
        headers: entry.server.headers,
        name: "browser",
        directory,
        instructions,
        tools: browserTools((sessionID) => {
          const pane = Array.from(served).find((item) => item.sessionID === sessionID)

          return (
            pane && {
              execute: (command, signal) => run(pane, command, signal),
              read: (path, signal) => client.file.read({ path, location: { directory } }, { signal }),
            }
          )
        }),
      }),
    })
  }

  /** Stops serving the pane's session, closing the connection once no pane uses it. */
  function unserve(entry: Entry) {
    const key = entry.served
    entry.served = undefined
    const group = key === undefined ? undefined : tools.get(key)

    if (key === undefined || !group) return
    group.entries.delete(entry)

    if (group.entries.size > 0) return
    tools.delete(key)
    void group.connection.close()
  }

  function run(entry: Entry, command: Browser.Command, signal: AbortSignal) {
    const request = {
      abort: new AbortController(),
      tabID: "tabID" in command.action ? command.action.tabID : undefined,
    }

    entry.requests.add(request)

    return execute(entry, command, AbortSignal.any([signal, request.abort.signal])).finally(() =>
      entry.requests.delete(request),
    )
  }

  function owned(window: number, binding: string) {
    const entry = entries.get(binding)

    if (!entry || entry.window !== window) throw new Error("browser.pane.unavailable")

    return entry
  }

  function publish(entry: Entry, event: PaneEvent) {
    if (!entries.has(entry.binding) || entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return
    input.emit(entry.window, { binding: entry.binding, event })
  }

  function close(entry: Entry, reason = "browser.pane.registration.closed") {
    if (entries.get(entry.binding) !== entry) return
    unserve(entry)
    entry.requests.forEach((request) => request.abort.abort())
    entry.requests.clear()
    const suspended = reason === "browser.pane.suspended"

    if (suspended) publishState(entry, reason)
    entry.pages.forEach((page) => void release(page).catch(() => undefined))
    entry.pages.clear()
    entry.tabs.clear()
    entry.focusedTabID = null

    if (!suspended) publishState(entry, reason)
    entries.delete(entry.binding)
    entry.cleanup?.()
    void entry.network?.close()
    entry.abort.abort()
  }

  async function closePage(entry: Entry, tabID: Browser.TabID, error?: string) {
    const page = entry.pages.get(tabID)

    if (!entry.tabs.has(tabID))
      throw new Error(
        "This tab is no longer available. Call browser.tabs.list({}) and use an existing tabID from this session.",
      )
    const focused = entry.focusedTabID === tabID
    entry.requests.forEach((request) => {
      if (request.tabID === tabID) request.abort.abort()
    })
    entry.pages.delete(tabID)
    entry.tabs.delete(tabID)

    if (focused) entry.focusedTabID = entry.tabs.keys().next().value ?? null

    if (page) await release(page)
    publishState(entry, error)
  }

  function release(page: BrowserPage) {
    const done = page.dispose()
    const settled = done.catch(() => undefined)
    releasing.add(settled)
    void settled.finally(() => releasing.delete(settled))

    return done
  }

  function publishState(entry: Entry, error?: string) {
    const current = { type: "state" as const, state: inventory(entry) }
    const event = error === undefined ? current : { ...current, error }

    // Teardown publishes an empty inventory to the renderer, but the saved URLs survive app exit.
    if (entry.served)
      restore.save(entry.storageKey, {
        tabs: event.state.tabs.map((tab) => ({
          id: tab.id,
          // A restored page can publish before Chromium assigns its URL.
          url: tab.url || entry.tabs.get(tab.id)?.url || "about:blank",
        })),
        focusedTabID: entry.focusedTabID,
      })
    const next = JSON.stringify(event)

    if (entry.lastState === next) return
    entry.lastState = next
    publish(entry, event)
  }

  function inventory(entry: Entry): Browser.State {
    return {
      tabs: Array.from(entry.tabs, ([id, tab]) => entry.pages.get(id)?.state() ?? tab),
      focusedTabID: entry.focusedTabID,
    }
  }

  function load(entry: Entry, tabID: Browser.TabID) {
    const page = entry.pages.get(tabID)

    if (page) return page
    const tab = entry.tabs.get(tabID)

    return tab ? create(entry, true, undefined, tab) : undefined
  }

  function create(
    entry: Entry,
    initialize = true,
    popupOptions?: Electron.BrowserWindowConstructorOptions,
    restore?: Browser.Tab,
  ) {
    if (!entry.network) throw new Error("Browser network is not ready; no tab was opened.")
    const id = restore?.id ?? Browser.TabID.make(`tab_${crypto.randomUUID()}`)

    const fail = () => {
      if (entry.pages.has(id)) void closePage(entry, id, "page_crashed").catch(() => undefined)
    }

    const page = createBrowserPage(entry.win, {
      id,
      partition: entry.partition,
      network: entry.network,
      initialize,
      restore,
      popupOptions,
      fileRoots: () => entry.fileRoots,
      shared,
      embeds: input.embeds,
      fail,
      publish: (error) => {
        if (entry.pages.has(id)) publishState(entry, error)
      },
      inspect: (event) => {
        if (entry.pages.has(id)) publish(entry, { type: "inspect", tabID: id, ...event })
      },
      // Icons and zoom follow the states published before them, so the window files a new page's icon under that
      // page's URL.
      detail: (value) => {
        if (entry.pages.has(id)) publish(entry, { type: "page", tabID: id, ...value })
      },
      zoomed: () => entry.pages.forEach((page) => page.detail()),
      shortcut: (shortcut) => {
        if (!entry.pages.has(id) || entry.focusedTabID !== id || entry.win.isDestroyed()) return

        // The page held keyboard focus; the command runs in the app, which may move focus there, as ⌘L does.
        if (entry.win.isFocused()) entry.win.webContents.focus()
        publish(entry, { type: "shortcut", ...shortcut })
      },
      focused: () => {
        if (entry.pages.has(id) && entry.focusedTabID === id) publish(entry, { type: "focused", tabID: id })
      },
      popup: (popupOptions, background) => {
        const popup = create(entry, false, popupOptions)

        if (!background) focus(entry, popup.state().id)

        return popup.contents
      },
    })

    entry.pages.set(id, page)
    entry.tabs.set(id, restore ?? page.state())
    publish(entry, { type: "embed", tabID: id, embed: page.embed })
    void page.ready
      .then(() => {
        if (entry.pages.get(id) === page) publishState(entry)
      })
      .catch(fail)

    return page
  }

  async function execute(entry: Entry, command: Browser.Command, signal: AbortSignal) {
    const action = command.action

    if (signal.aborted)
      throw new Error(
        "Browser request was cancelled. Do not repeat a mutating action until you have inspected its outcome.",
      )

    if (action.type === "tabs.list") return { value: inventory(entry), files: [] }

    if (action.type === "preview") {
      // The renderer owns file tabs; it resolves the path against the session's workspace.
      publish(entry, { type: "preview", path: action.path })

      return { value: { path: action.path }, files: [] }
    }

    if (action.type === "tabs.open") {
      const page = create(entry)

      if (action.focus !== false) focus(entry, page.state().id)
      await page.ready

      // A new page already loads about:blank, so only another address needs a navigation.
      if (action.url !== undefined)
        await page.execute({ action: { type: "navigate", tabID: page.state().id, url: action.url }, files: [] }, signal)
      publishState(entry)

      return { value: page.state(), files: [] }
    }

    const tab = inventory(entry).tabs.find((tab) => tab.id === action.tabID)

    if (!tab)
      throw new Error(
        "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID from this session; a closed tab is not replaced automatically.",
      )

    if (action.type === "tabs.focus") {
      focus(entry, action.tabID)

      return { value: tab, files: [] }
    }

    if (action.type === "tabs.close") {
      await closePage(entry, action.tabID)

      return { value: inventory(entry), files: [] }
    }

    const page = entry.pages.get(action.tabID) ?? create(entry, true, undefined, tab)
    await page.ready
    const result = await page.execute(command, signal)
    publishState(entry)

    return result
  }

  function focus(entry: Entry, tabID: Browser.TabID) {
    entry.focusedTabID = tabID
    publishState(entry)
    publish(entry, { type: "focus", tabID })
  }
}
