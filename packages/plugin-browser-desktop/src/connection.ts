import type { MainPlugin } from "@opencode/plugin/desktop/main"
import { Browser } from "@opencode/plugin-browser/rpc"
import { SessionID } from "@opencode/schema/session-id"
import type { BrowserWindow } from "electron"
import { Deferred, Effect, Layer, ManagedRuntime, Queue, Schedule, Schema, Stream } from "effect"
import { createBrowserPage, type BrowserPage } from "./page"
import { browserFailure } from "./native/errors"
import { createBrowserNetwork, type BrowserNetwork } from "./native/network"
import { BrowserDesktop } from "./rpc"

type Entry = {
  bindingID: string
  win: BrowserWindow
  abort: AbortController
  registered: PromiseWithResolvers<void>
  requests: Map<string, { abort: AbortController; tabID?: Browser.TabID }>
  report?: (event: BrowserDesktop.Event) => void
  cleanup?: () => void
  pages: Map<Browser.TabID, BrowserPage>
  focusedTabID: Browser.TabID | null
  partition: string
  lastState?: string
  network?: BrowserNetwork
}

export function createBrowserPane(ctx: MainPlugin.Context) {
  const entries = new Map<string, Entry>()
  // Keep long-lived RPC requests off Chromium's shared HTTP connection pool.
  const runtime = ManagedRuntime.make(Layer.empty)
  let disposed = false
  return {
    async register(bindingID: string, target: { sessionID: string; serverID: string }, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const win = ctx.window
      if (disposed) throw new Error("browser.pane.registration.invalid")
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
      let reason: "browser.pane.unsupported" | "browser.pane.replaced" | undefined
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
            const client = yield* Effect.promise(() => ctx.client(target.serverID))
            const session = yield* client.session.get({ sessionID })
            const options = {
              location: { directory: session.location.directory, workspace: session.location.workspaceID },
            }
            const attachment = { sessionID, connectionID: crypto.randomUUID() }
            const rpc = client.rpc(Browser.Definition)
            entry.network = yield* createBrowserNetwork({
              rpc,
              attachment,
              location: options.location,
              partition: entry.partition,
            })
            const connected = yield* Deferred.make<void>()
            const outbound = yield* Queue.unbounded<Effect.Effect<void>>()
            // A send that fails because the server already replaced or closed this attachment must
            // not decide the close reason; only the attach call's outcome does.
            const send = (effect: Effect.Effect<unknown, unknown>) =>
              Queue.offerUnsafe(
                outbound,
                effect.pipe(Effect.catchCause((cause) => Effect.logWarning("Browser send failed", cause))),
              )
            const reply = (requestID: string, outcome: Browser.Outcome) =>
              send(
                rpc.result({ ...attachment, requestID, outcome: Schema.encodeSync(Browser.Outcome)(outcome) }, options),
              )
            // Report state before publishing it locally or completing a command. The server's copy of
            // the inventory resolves every tab ID, so a state is retried until it arrives or the
            // attachment ends; the results queued behind it then never name a tab the server lacks.
            // "unavailable" means the server already dropped this attachment, which attach reports.
            entry.report = (event) => {
              const local = Effect.promise(() => publish(entry, event))
              if (event.type !== "state") return send(local)
              send(
                rpc.state({ ...attachment, state: event.state ?? { tabs: [], focusedTabID: null } }, options).pipe(
                  Effect.retry({
                    while: (error) => !("type" in error && error.type === "unavailable"),
                    schedule: Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("10 seconds")]),
                  }),
                  Effect.ensuring(local),
                ),
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
                        reply(
                          message.requestID,
                          await execute(entry, command, abort.signal).then(
                            (result) => ({ type: "success" as const, result }),
                            (error: unknown) => browserFailure(command.action, error),
                          ),
                        )
                      }),
                    ),
                    Effect.ensuring(Effect.sync(() => entry.requests.delete(message.requestID))),
                    // An operation this desktop cannot decode comes from a newer plugin; answer it so
                    // the agent does not wait out the server's timeout.
                    Effect.tapError((error) =>
                      Effect.sync(() => {
                        if (!Schema.isSchemaError(error)) return
                        reply(message.requestID, {
                          type: "failure",
                          code: "unsupported",
                          message:
                            "This desktop app does not support the requested browser operation. Ask the user to update the desktop app, or use another operation.",
                        })
                      }),
                    ),
                    // A request that vanished (cancelled before retrieval) fails only that request.
                    // Transport loss surfaces through the event stream and attach call instead.
                    Effect.catchCause((cause) =>
                      abort.signal.aborted ? Effect.void : Effect.logWarning("Browser command failed", cause),
                    ),
                    Effect.forkScoped,
                  )
                }),
              ),
            )
            yield* Effect.raceAllFirst([
              receive,
              Stream.fromQueue(outbound).pipe(Stream.runForEach((send) => send)),
              Deferred.await(connected).pipe(
                Effect.andThen(rpc.attach({ ...attachment, version: 4 }, options)),
                Effect.tap((result) =>
                  Effect.sync(() => {
                    if (result === "replaced") reason = "browser.pane.replaced"
                  }),
                ),
              ),
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
      signal?.addEventListener("abort", stop, { once: true })
      await entry.registered.promise.finally(() => {
        clearTimeout(timeout)
        signal?.removeEventListener("abort", stop)
      })
      if (entries.get(bindingID) !== entry) throw new Error("browser.pane.registration.closed")
      publishState(entry)
    },
    async command(bindingID: string, command: Browser.Action, signal = ctx.lifecycle.signal) {
      const entry = owned(bindingID)
      await execute(entry, { action: command, files: [] }, signal)
    },
    async close(bindingID: string) {
      close(owned(bindingID))
    },
    async dispose() {
      disposed = true
      entries.forEach((entry) => close(entry))
      await runtime.dispose()
    },
  }

  function owned(bindingID: string) {
    const entry = entries.get(bindingID)
    if (!entry || entry.win !== ctx.window) throw new Error("browser.pane.unavailable")
    return entry
  }

  async function publish(entry: Entry, event: BrowserDesktop.Event) {
    if (!entries.has(entry.bindingID) || entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return
    await ctx.emit(BrowserDesktop.Definition, "changed", { bindingID: entry.bindingID, event })
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
    if (!page)
      throw new Error(
        "This tab is no longer available. Call browser.tabs.list({}) and use an existing tabID from this session.",
      )
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
      surfaces: Object.fromEntries(Array.from(entry.pages.values(), (page) => [page.state().id, page.surfaceID])),
      ...(error === undefined ? {} : { error }),
    }
    const next = JSON.stringify(event)
    if (entry.lastState === next) return
    entry.lastState = next
    report(entry, event)
  }

  function report(entry: Entry, event: BrowserDesktop.Event) {
    if (entry.report) return entry.report(event)
    void publish(entry, event).catch(console.error)
  }

  function create(entry: Entry, initialize = true, popupOptions?: Electron.BrowserWindowConstructorOptions) {
    if (!entry.network) throw new Error("Browser network is not ready; no tab was opened.")
    const id = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
    const fail = () => {
      if (entry.pages.has(id)) void closePage(entry, id, "page_crashed").catch(() => undefined)
    }
    const page = createBrowserPage(entry.win, {
      id,
      surfaces: ctx.surfaces,
      partition: entry.partition,
      network: entry.network,
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
    if (signal.aborted)
      throw new Error(
        "Browser request was cancelled. Do not repeat a mutating action until you have inspected its outcome.",
      )
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
    if (!page)
      throw new Error(
        "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID from this session; a closed tab is not replaced automatically.",
      )
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
