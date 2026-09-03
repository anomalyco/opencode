import type { BrowserPaneCommand, BrowserPaneLayout, BrowserPaneTarget } from "@opencode-ai/app/desktop"
import { NodeHttpClient } from "@effect/platform-node"
import { Browser } from "@opencode-ai/schema/browser"
import { OpenCode } from "@opencode-ai/client/effect"
import { SessionID } from "@opencode-ai/schema/session-id"
import type { BrowserWindow } from "electron"
import { Deferred, Effect, ManagedRuntime, Queue, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { BrowserPaneEvent } from "../shared/ipc-rpc/events"
import { createBrowserPage, destinationOrigin, type BrowserPage } from "./browser-chromium"
import { emitIpcEvent } from "./ipc-events"

type Entry = {
  bindingID: string
  win: BrowserWindow
  abort: AbortController
  registered: PromiseWithResolvers<void>
  requests: Map<string, { abort: AbortController; tabID?: Browser.TabID }>
  report?: (event: BrowserPaneEvent["event"]) => void
  cleanup?: () => void
  pages: Map<Browser.TabID, BrowserPage>
  focusedTabID: Browser.TabID | null
  partition: string
  lastState?: string
}

export function createBrowserPane() {
  const entries = new Map<string, Entry>()
  // Keep long-lived RPC requests off Chromium's shared HTTP connection pool.
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp)
  let disposed = false
  return {
    async register(win: BrowserWindow, bindingID: string, target: BrowserPaneTarget) {
      if (disposed || !destinationOrigin(target.endpoint.url)) throw new Error("browser.pane.registration.invalid")
      if (target.endpoint.username && !target.endpoint.password) throw new Error("browser.pane.endpoint.invalid")
      if (entries.has(bindingID)) throw new Error("browser.pane.owner.invalid")
      if (win.isDestroyed() || win.webContents.isDestroyed()) throw new Error("browser.pane.owner.unavailable")
      const sessionID = SessionID.make(target.sessionID)
      const entry: Entry = {
        bindingID,
        win,
        abort: new AbortController(),
        registered: Promise.withResolvers(),
        requests: new Map(),
        pages: new Map(),
        focusedTabID: null,
        partition: `opencode-browser-${crypto.randomUUID()}`,
      }
      // "unsupported" means the server has no browser plugin; the renderer stops retrying.
      let reason: "browser.pane.unsupported" | undefined
      const stop = () => close(entry, reason)
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
      entries.set(bindingID, entry)
      void runtime
        .runPromise(
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const client = yield* OpenCode.make({ baseUrl: target.endpoint.url }).pipe(
              Effect.provideService(
                HttpClient.HttpClient,
                target.endpoint.password
                  ? HttpClient.mapRequest(
                      http,
                      HttpClientRequest.basicAuth(target.endpoint.username ?? "opencode", target.endpoint.password),
                    )
                  : http,
              ),
            )
            const session = yield* client.session.get({ sessionID })
            const options = {
              location: { directory: session.location.directory, workspace: session.location.workspaceID },
            }
            const attachment = { sessionID, connectionID: crypto.randomUUID() }
            const rpc = client.rpc(Browser.Definition)
            const connected = yield* Deferred.make<void>()
            const outbound = yield* Queue.unbounded<Effect.Effect<void, unknown>>()
            // Report state before publishing it locally or completing a command.
            entry.report = (event) => {
              Queue.offerUnsafe(
                outbound,
                (event.type === "state"
                  ? rpc.state({ ...attachment, state: event.state ?? { tabs: [], focusedTabID: null } }, options)
                  : Effect.void
                ).pipe(Effect.andThen(Effect.sync(() => publish(entry, event)))),
              )
            }
            const receive = client.event.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "server.connected") {
                    yield* Deferred.succeed(connected, undefined)
                    return
                  }
                  if (
                    event.type !== "rpc.experimental.browser.control" ||
                    event.data.connectionID !== attachment.connectionID
                  )
                    return
                  const message = yield* Schema.decodeUnknownEffect(Browser.Control)(event.data).pipe(
                    Effect.tapError(() =>
                      Effect.sync(() => {
                        reason = "browser.pane.unsupported"
                      }),
                    ),
                  )
                  if (message.type === "attached") return entry.registered.resolve()
                  if (message.type === "cancel") return entry.requests.get(message.requestID)?.abort.abort()
                  const abort = new AbortController()
                  entry.requests.set(message.requestID, { abort })
                  yield* rpc.command({ ...attachment, requestID: message.requestID }, options).pipe(
                    Effect.flatMap((command) =>
                      Effect.promise(async () => {
                        entry.requests.set(message.requestID, {
                          abort,
                          ...("tabID" in command.action ? { tabID: command.action.tabID } : {}),
                        })
                        const outcome: Browser.Outcome = await execute(entry, command, abort.signal).then(
                          (result) => ({ type: "success" as const, result }),
                          (error: unknown) => ({
                            type: "failure" as const,
                            code: "operation_failed",
                            message: (error instanceof Error ? error.message : String(error)).slice(0, 1_024),
                          }),
                        )
                        Queue.offerUnsafe(
                          outbound,
                          rpc.result(
                            {
                              ...attachment,
                              requestID: message.requestID,
                              outcome: Schema.encodeSync(Browser.Outcome)(outcome),
                            },
                            options,
                          ),
                        )
                      }),
                    ),
                    Effect.ensuring(
                      Effect.sync(() => {
                        abort.abort()
                        entry.requests.delete(message.requestID)
                      }),
                    ),
                    Effect.catchCause((cause) =>
                      abort.signal.aborted
                        ? Effect.void
                        : Effect.logError("Browser command failed", cause).pipe(Effect.andThen(Effect.sync(stop))),
                    ),
                    Effect.forkScoped,
                  )
                }),
              ),
            )
            yield* Effect.raceAllFirst([
              receive,
              Stream.fromQueue(outbound).pipe(Stream.runForEach((send) => send)),
              Deferred.await(connected).pipe(Effect.andThen(rpc.attach({ ...attachment, version: 2 }, options))),
            ])
          }).pipe(
            Effect.scoped,
            Effect.tapError((error) =>
              Effect.sync(() => {
                const type = error instanceof Object && "type" in error ? error.type : undefined
                if (type === "rpc.unavailable" || type === "rpc.method_not_found" || type === "rpc.invalid_input")
                  reason = "browser.pane.unsupported"
              }),
            ),
            Effect.ensuring(Effect.sync(stop)),
          ),
          { signal: entry.abort.signal },
        )
        .catch(stop)
      const timeout = setTimeout(stop, 15_000)
      await entry.registered.promise.finally(() => clearTimeout(timeout))
      if (entries.get(bindingID) !== entry) throw new Error("browser.pane.registration.closed")
      publishState(entry)
    },
    layout(win: BrowserWindow, bindingID: string, value?: BrowserPaneLayout) {
      const entry = owned(win, bindingID)
      if (!value) return entry.pages.forEach((page) => page.view.setVisible(false))
      const page = entry.pages.get(value.tabID)
      if (!page) return
      const bounds = value.bounds
      if (!value.visible || !bounds || bounds.width <= 0 || bounds.height <= 0) {
        page.view.setVisible(false)
        return
      }
      entry.pages.forEach((other) => {
        if (other !== page) other.view.setVisible(false)
      })
      page.view.setBounds(bounds)
      page.view.setVisible(true)
    },
    async command(win: BrowserWindow, bindingID: string, command: BrowserPaneCommand) {
      const entry = owned(win, bindingID)
      await execute(entry, { action: command, files: [] }, new AbortController().signal)
    },
    async close(win: BrowserWindow, bindingID: string) {
      close(owned(win, bindingID))
    },
    async dispose() {
      disposed = true
      entries.forEach(close)
      await runtime.dispose()
    },
  }

  function owned(win: BrowserWindow, bindingID: string) {
    const entry = entries.get(bindingID)
    if (!entry || entry.win !== win) throw new Error("browser.pane.unavailable")
    return entry
  }

  function publish(entry: Entry, event: BrowserPaneEvent["event"]) {
    if (!entries.has(entry.bindingID) || entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return
    emitIpcEvent(entry.win.webContents, new BrowserPaneEvent({ bindingID: entry.bindingID, event }))
  }

  function close(entry: Entry, reason = "browser.pane.registration.closed") {
    if (entries.get(entry.bindingID) !== entry) return
    entry.report = undefined
    entry.requests.forEach((request) => request.abort.abort())
    entry.requests.clear()
    entry.pages.forEach((page) => {
      void page.dispose().catch(() => undefined)
    })
    entry.pages.clear()
    entry.focusedTabID = null
    publishState(entry, reason)
    entries.delete(entry.bindingID)
    entry.registered.reject(new Error("browser.pane.registration.closed"))
    entry.cleanup?.()
    entry.abort.abort()
  }

  async function closePage(entry: Entry, tabID: Browser.TabID, error?: string) {
    const page = entry.pages.get(tabID)
    if (!page) throw new Error("Browser tab is unavailable.")
    const focused = entry.focusedTabID === tabID
    entry.requests.forEach((request) => {
      if (request.tabID === tabID) request.abort.abort()
    })
    entry.pages.delete(tabID)
    if (focused) entry.focusedTabID = entry.pages.keys().next().value ?? null
    await page.dispose()
    publishState(entry, error)
  }

  function publishState(entry: Entry, error?: string) {
    const event = {
      type: "state" as const,
      state: { tabs: Array.from(entry.pages.values(), (page) => page.state()), focusedTabID: entry.focusedTabID },
      ...(error === undefined ? {} : { error }),
    }
    const next = JSON.stringify(event)
    if (entry.lastState === next) return
    entry.lastState = next
    report(entry, event)
  }

  function report(entry: Entry, event: BrowserPaneEvent["event"]) {
    if (entry.report) return entry.report(event)
    publish(entry, event)
  }

  function create(entry: Entry, initialize = true, popupOptions?: Electron.BrowserWindowConstructorOptions) {
    const id = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
    const fail = () => {
      if (entry.pages.has(id)) void closePage(entry, id, "page_crashed").catch(() => undefined)
    }
    const page = createBrowserPage(entry.win, {
      id,
      partition: entry.partition,
      initialize,
      popupOptions,
      fail,
      publish: (error) => {
        if (entry.pages.has(id)) publishState(entry, error)
      },
      popup: (popupOptions) => {
        const popup = create(entry, false, popupOptions)
        focus(entry, popup.state().id)
        return popup.contents
      },
    })
    entry.pages.set(id, page)
    void page.ready
      .then(() => {
        if (entry.pages.get(id) === page) publishState(entry)
      })
      .catch(fail)
    return page
  }

  async function execute(entry: Entry, command: Browser.Command, signal: AbortSignal) {
    const action = command.action
    const state = () => ({
      tabs: Array.from(entry.pages.values(), (page) => page.state()),
      focusedTabID: entry.focusedTabID,
    })
    if (signal.aborted) throw new Error("Browser request was cancelled.")
    if (action.type === "tabs.list") return { value: state(), files: [] }
    if (action.type === "tabs.open") {
      const page = create(entry)
      if (action.focus !== false) focus(entry, page.state().id)
      await page.ready
      await page.execute(
        { action: { type: "navigate", tabID: page.state().id, url: action.url ?? "about:blank" }, files: [] },
        signal,
      )
      publishState(entry)
      return { value: page.state(), files: [] }
    }
    const page = entry.pages.get(action.tabID)
    if (!page) throw new Error("Browser tab is unavailable. Call browser.tabs.list.")
    if (action.type === "tabs.focus") {
      focus(entry, action.tabID)
      return { value: page.state(), files: [] }
    }
    if (action.type === "tabs.close") {
      await closePage(entry, action.tabID)
      return { value: state(), files: [] }
    }
    await page.ready
    const result = await page.execute(command, signal)
    publishState(entry)
    return result
  }

  function focus(entry: Entry, tabID: Browser.TabID) {
    entry.focusedTabID = tabID
    publishState(entry)
    report(entry, { type: "focus", tabID })
  }
}
