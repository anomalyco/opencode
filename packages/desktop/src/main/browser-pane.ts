import type { BrowserPaneCommand, BrowserPaneLayout, BrowserPaneTarget } from "@opencode-ai/app/desktop"
import { NodeHttpClient } from "@effect/platform-node"
import { Browser } from "@opencode-ai/browser/rpc"
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
  requests: Map<string, AbortController>
  report?: (event: Extract<BrowserPaneEvent["event"], { type: "state" }>) => void
  cleanup?: () => void
  page?: BrowserPage
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
      }
      const stop = () => close(entry)
      const navigate = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (event.isMainFrame && !event.isSameDocument) stop()
      }
      win.webContents.once("destroyed", stop)
      win.webContents.on("did-start-navigation", navigate)
      entry.cleanup = () => {
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
                rpc
                  .state({ ...attachment, state: event.state }, options)
                  .pipe(Effect.tap(() => Effect.sync(() => publish(entry, event)))),
              )
            }
            const receive = client.event.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "server.connected") {
                    yield* Deferred.succeed(connected, undefined)
                    return
                  }
                  if (event.type !== "rpc.experimental.browser.control") return
                  const message = yield* Schema.decodeUnknownEffect(Browser.Control)(event.data)
                  if (message.connectionID !== attachment.connectionID) return
                  if (message.type === "attached") return entry.registered.resolve()
                  if (message.type === "cancel") return entry.requests.get(message.requestID)?.abort()
                  const abort = new AbortController()
                  entry.requests.set(message.requestID, abort)
                  yield* Effect.promise(async () => {
                    const outcome: Browser.Outcome = await execute(entry, message.command, abort.signal).then(
                      (result) => ({ type: "success" as const, result }),
                      (error: unknown) => ({
                        type: "failure" as const,
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
                  }).pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        abort.abort()
                        entry.requests.delete(message.requestID)
                      }),
                    ),
                    Effect.catchCause(() => Effect.sync(stop)),
                    Effect.forkScoped,
                  )
                }),
              ),
            )
            yield* Effect.raceAllFirst([
              receive,
              Stream.fromQueue(outbound).pipe(Stream.runForEach((send) => send)),
              Deferred.await(connected).pipe(Effect.andThen(rpc.attach(attachment, options))),
            ])
          }).pipe(Effect.scoped, Effect.ensuring(Effect.sync(stop))),
          { signal: entry.abort.signal },
        )
        .catch(stop)
      await entry.registered.promise
      if (entries.get(bindingID) !== entry) throw new Error("browser.pane.registration.closed")
      publishState(entry)
    },
    layout(win: BrowserWindow, bindingID: string, value?: BrowserPaneLayout) {
      const entry = owned(win, bindingID)
      if (!value) return closePage(entry)
      const bounds = value.bounds
      if (!value.visible || !bounds || bounds.width <= 0 || bounds.height <= 0) {
        entry.page?.view.setVisible(false)
        return
      }
      const page = create(entry)
      page.view.setBounds(bounds)
      page.view.setVisible(true)
    },
    async command(win: BrowserWindow, bindingID: string, command: BrowserPaneCommand) {
      const entry = owned(win, bindingID)
      await execute(
        entry,
        { action: command, generation: entry.page?.state().generation ?? 0 },
        new AbortController().signal,
      )
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

  function close(entry: Entry) {
    if (entries.get(entry.bindingID) !== entry) return
    entry.report = undefined
    closePage(entry, "browser.pane.registration.closed")
    entries.delete(entry.bindingID)
    entry.registered.reject(new Error("browser.pane.registration.closed"))
    entry.cleanup?.()
    entry.abort.abort()
  }

  function closePage(entry: Entry, error?: string) {
    entry.requests.forEach((request) => request.abort())
    entry.requests.clear()
    entry.page?.dispose()
    entry.page = undefined
    publishState(entry, error)
  }

  function publishState(entry: Entry, error?: string) {
    const event = {
      type: "state" as const,
      state: entry.page?.state() ?? null,
      ...(error === undefined ? {} : { error }),
    }
    if (entry.report) return entry.report(event)
    publish(entry, event)
  }

  function create(entry: Entry) {
    if (entry.page) return entry.page
    const fail = () => {
      if (entry.page === page) closePage(entry, "page_crashed")
    }
    const page = createBrowserPage(
      entry.win,
      (error) => {
        if (entry.page === page) publishState(entry, error)
      },
      fail,
    )
    entry.page = page
    void page.ready
      .then(() => {
        if (entry.page === page) publishState(entry)
      })
      .catch(fail)
    return page
  }

  async function execute(entry: Entry, command: Browser.Command, signal: AbortSignal) {
    if (command.action.type === "open") publish(entry, { type: "open" })
    const page = command.action.type === "open" ? create(entry) : entry.page
    if (!page) throw new Error("not_attached")
    await page.ready
    return page.execute(command, signal)
  }
}
