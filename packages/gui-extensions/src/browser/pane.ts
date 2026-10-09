import { NodeHttpClient } from "@effect/platform-node"
import { Browser } from "@opencode/plugin-browser/rpc"
import { OpenCode } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import electron, { type BrowserWindow } from "electron"
import { Deferred, Effect, ManagedRuntime, Queue, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { Embeds, Persisted, ServerEndpoints, Storage, Windows } from "../sdk/main"
import { createBrowserPage, type BrowserPage, type Shared } from "./chromium"
import { browserFailure } from "./errors"
import { createBrowserNetwork, type BrowserNetwork } from "./network"
import { createPresenters } from "./presenter"
import { destinationOrigin, fileURLWithin, refusal } from "./policy"
import { createRefs } from "./refs"
import type { PaneEvent } from "./ipc"
import { createBrowserRestoreStore } from "./restore"

type Target = { readonly server: string; readonly session: string; readonly restore?: Browser.State }

type Answer =
  | { readonly type: "previewed"; readonly opened: boolean; readonly reason: "queued" | "unavailable" | undefined }
  | { readonly type: "handoff"; readonly done: boolean }

/** Who asked for an action: the agent through the server, or the user through the pane's own controls. */
type Origin = "agent" | "user"

type Entry = {
  binding: string
  window: number
  win: BrowserWindow
  abort: AbortController
  registered: ReturnType<typeof Promise.withResolvers<void>>
  requests: Map<string, { abort: AbortController; tabID?: Browser.TabID }>
  /** The window's answers the agent waits for: preview acknowledgements and handoffs, by request ID. */
  answers: Map<string, { tabID?: Browser.TabID; resolve: (value: Answer) => void }>
  report?: (event: PaneEvent) => void
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

export type Pane = ReturnType<typeof createBrowserPane>

export function createBrowserPane(input: {
  readonly windows: Windows
  readonly serverEndpoints: ServerEndpoints
  readonly storage: Storage
  /** The declared store of reserved element refs. */
  readonly refs: Persisted<number, number>
  readonly embeds: Embeds
  readonly emit: (window: number, value: { readonly binding: string; readonly event: PaneEvent }) => void
}) {
  const entries = new Map<string, Entry>()
  const restore = createBrowserRestoreStore(input.storage)
  const shared: Shared = { ref: createRefs(input.refs) }
  const presenters = createPresenters()
  // Page disposals in flight. Finishing a trace or CPU profile can hold a page open, and the pane's own disposal waits
  // for them so a replacement never starts beside old pages still recording.
  const releasing = new Set<Promise<void>>()
  // Keep long-lived RPC requests off Chromium's shared HTTP connection pool.
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp)
  let disposed = false

  return {
    async register(window: number, binding: string, target: Target) {
      const server = input.serverEndpoints.get(target.server)

      if (disposed || !server || !destinationOrigin(server.url)) throw new Error("browser.pane.registration.invalid")

      if (server.username && !server.password) throw new Error("browser.pane.endpoint.invalid")
      const win = input.windows.get(window)

      if (!win || entries.has(binding)) throw new Error("browser.pane.owner.invalid")

      if (win.isDestroyed() || win.webContents.isDestroyed()) throw new Error("browser.pane.owner.unavailable")
      const sessionID = SessionID.make(target.session)
      const storageKey = `${target.server}\n${sessionID}`
      const saved = restore.load(storageKey)

      const previous: Browser.State = target.restore ?? {
        tabs: saved.tabs.map((tab) => ({
          ...tab,
          // Tabs saved before tabs had owners were the user's.
          owner: tab.owner ?? "user",
          watched: false,
          title: "",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          generation: 0,
        })),
        focusedTabID: saved.focusedTabID,
      }

      const entry: Entry = {
        binding,
        window,
        win,
        abort: new AbortController(),
        registered: Promise.withResolvers(),
        requests: new Map(),
        answers: new Map(),
        pages: new Map(),
        tabs: new Map(
          previous.tabs.map((tab) => [
            tab.id,
            {
              ...tab,
              loading: false,
              canGoBack: false,
              canGoForward: false,
              watched: false,
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
      // file: URLs outside the roots. One listener per partition covers every page in this attachment.
      electron.session
        .fromPartition(entry.partition)
        .webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) =>
          callback({ cancel: !fileURLWithin(details.url, entry.fileRoots) }),
        )
      // "unsupported" means the server has no browser plugin; the renderer stops retrying.
      let reason: "browser.pane.unsupported" | "browser.pane.replaced" | "browser.pane.suspended" | undefined
      let attached = false
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

      entries.set(binding, entry)
      void runtime
        .runPromise(
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient

            // The renderer never holds the managed sidecar's password; Node requests bypass
            // the webRequest header injection, so the host resolves the credential here in main.
            const client = yield* OpenCode.make({ baseUrl: server.url }).pipe(
              Effect.provideService(
                HttpClient.HttpClient,
                Object.keys(server.headers).length
                  ? HttpClient.mapRequest(http, HttpClientRequest.setHeaders(server.headers))
                  : http,
              ),
            )

            const session = yield* client.session.get({ sessionID })

            // The agent can already read this workspace, so showing its files adds no access.
            if (server.local) entry.fileRoots = [session.location.directory]

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
              const local = Effect.sync(() => publish(entry, event))

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

                  if (message.type === "attached") {
                    attached = true

                    return entry.registered.resolve()
                  }

                  if (message.type === "cancel") return entry.requests.get(message.requestID)?.abort.abort()
                  const abort = new AbortController()
                  entry.requests.set(message.requestID, { abort })
                  yield* rpc.command({ ...attachment, requestID: message.requestID }, options).pipe(
                    Effect.flatMap((command) =>
                      Effect.promise(async () => {
                        entry.requests.set(
                          message.requestID,
                          "tabID" in command.action ? { abort, tabID: command.action.tabID } : { abort },
                        )
                        reply(
                          message.requestID,
                          await execute(entry, command, abort.signal).then(
                            (result) => ({ type: "success" as const, result }),
                            (cause: unknown) => browserFailure(command.action, cause),
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
                Effect.andThen(rpc.attach({ ...attachment, version: Browser.VERSION }, options)),
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

                if (type === "rpc.unavailable" && attached) {
                  reason = "browser.pane.suspended"

                  return
                }

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

      if (entries.get(binding) !== entry) throw new Error("browser.pane.registration.closed")
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
      await execute(entry, { action: command, files: [] }, new AbortController().signal, "user")
    },
    /** The window opened the agent's preview, or queued it until the user returns to the session. */
    previewed(window: number, binding: string, requestID: string, opened: boolean, reason?: "queued" | "unavailable") {
      owned(window, binding).answers.get(requestID)?.resolve({ type: "previewed", opened, reason })
    },
    /** The user finished or dismissed the agent's handoff. */
    handoff(window: number, binding: string, requestID: string, done: boolean) {
      owned(window, binding).answers.get(requestID)?.resolve({ type: "handoff", done })
    },
    async close(window: number, binding: string) {
      const entry = owned(window, binding)
      restore.remove(entry.storageKey)
      close(entry)
    },
    /**
     * The extension is going away (reload, disable, or quit). Windows keep each pane's tabs as a
     * suspended attachment, like an idle server eviction, and register again once the pane is back.
     */
    async dispose() {
      disposed = true
      entries.forEach((entry) => close(entry, "browser.pane.suspended"))
      await Promise.all(releasing)
      presenters.dispose()
      await runtime.dispose()
    },
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
    entry.report = undefined
    entry.requests.forEach((request) => request.abort.abort())
    entry.requests.clear()
    entry.answers.clear()
    const suspended = reason === "browser.pane.suspended"

    if (suspended) publishState(entry, reason)
    entry.pages.forEach((page) => void release(page).catch(() => undefined))
    entry.pages.clear()
    entry.tabs.clear()
    entry.focusedTabID = null

    if (!suspended) publishState(entry, reason)
    entries.delete(entry.binding)
    entry.registered.reject(new Error("browser.pane.registration.closed"))
    entry.cleanup?.()
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
    if (entry.report)
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
    report(entry, event)
  }

  function report(entry: Entry, event: PaneEvent) {
    if (entry.report) return entry.report(event)
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
    kind: { readonly owner: Origin; readonly key?: string } = { owner: restore?.owner ?? "user", key: restore?.key },
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
      owner: kind.owner,
      key: kind.key,
      viewport: restore?.viewport,
      presenters,
      fileRoots: () => entry.fileRoots,
      shared,
      embeds: input.embeds,
      fail,
      // A link the agent's tab opens in a new tab becomes another agent tab; the agent finds it in tabs.list.
      open: (url, background) => {
        const opened = create(entry, true, undefined, undefined, { owner: "agent" })

        if (!background) focus(entry, opened.state().id)
        void opened.ready
          .then(() =>
            opened.execute(
              { action: { type: "navigate", tabID: opened.state().id, url }, files: [] },
              new AbortController().signal,
            ),
          )
          .then(() => publishState(entry))
          .catch(() => undefined)
      },
      publish: (error) => {
        if (entry.pages.has(id)) publishState(entry, error)
      },
      inspect: (event) => {
        if (entry.pages.has(id)) report(entry, { type: "inspect", tabID: id, ...event })
      },
      // Icons and zoom are local to this desktop, but wait behind the states reported before them, so the window files
      // a new page's icon under that page's URL.
      detail: (value) => {
        if (entry.pages.has(id)) report(entry, { type: "page", tabID: id, ...value })
      },
      zoomed: () => entry.pages.forEach((page) => page.detail()),
      address: () => {
        if (!entry.pages.has(id) || entry.win.isDestroyed()) return
        // The page held keyboard focus; the app's address field needs it back.
        entry.win.webContents.focus()
        publish(entry, { type: "address", tabID: id })
      },
      popup: (popupOptions, background) => {
        const popup = create(entry, false, popupOptions)

        if (!background) focus(entry, popup.state().id)

        return popup.contents
      },
    })

    entry.pages.set(id, page)
    entry.tabs.set(id, restore ?? page.state())
    // Straight to the window, not through the server report: the embed is local to this desktop.
    publish(entry, { type: "embed", tabID: id, embed: page.embed })
    void page.ready
      .then(() => {
        if (entry.pages.get(id) === page) publishState(entry)
      })
      .catch(fail)

    return page
  }

  async function execute(
    entry: Entry,
    command: Browser.Command,
    signal: AbortSignal,
    origin: Origin = "agent",
  ): Promise<Browser.Result> {
    const action = command.action

    if (signal.aborted)
      throw new Error(
        "Browser request was cancelled. Do not repeat a mutating action until you have inspected its outcome.",
      )

    if (action.type === "tabs.list") return { value: inventory(entry), files: [] }

    if (action.type === "preview") {
      // The renderer owns file tabs; it resolves the path against the session's workspace and answers whether the
      // preview opened now or waits for the user to return to the session.
      const requestID = crypto.randomUUID()

      const answer = await ask(entry, requestID, undefined, signal, 5_000, () =>
        report(entry, { type: "preview", path: action.path, requestID }),
      )

      const opened = answer?.type === "previewed" ? answer : undefined

      if (opened?.opened) return { value: { path: action.path, opened: true }, files: [] }

      return {
        value: {
          path: action.path,
          opened: false,
          reason:
            opened?.reason === "queued"
              ? "The user is looking at another session; it opens when they return to this one."
              : "No desktop window could show the preview.",
        },
        files: [],
      }
    }

    if (action.type === "tabs.open") {
      const reused = action.key
        ? Array.from(entry.pages.values()).find((page) => {
            const tab = page.state()

            return tab.key === action.key && tab.owner === "agent"
          })
        : undefined

      const page = reused ?? create(entry, true, undefined, undefined, { owner: origin, key: action.key })

      if (action.focus !== false) focus(entry, page.state().id)
      await page.ready
      const tabID = page.state().id

      if (action.viewport || action.colorScheme)
        await page.execute(
          {
            action: { type: "emulate", tabID, viewport: action.viewport, colorScheme: action.colorScheme },
            files: [],
          },
          signal,
        )

      // A reused tab already showing the page keeps its state.
      const loaded =
        reused && (action.url === undefined || reused.state().url === action.url)
          ? { value: page.state(), files: [] }
          : await page.execute(
              {
                action: {
                  type: "navigate",
                  tabID,
                  url: action.url ?? "about:blank",
                  waitUntil: action.waitUntil,
                  timeoutMs: action.timeoutMs,
                },
                files: [],
              },
              signal,
            )

      publishState(entry)
      const status = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.optionalKey(Schema.Int) }))(loaded.value)
      const tab = { ...page.state(), reused: reused !== undefined }

      return { value: status.status === undefined ? tab : { ...tab, status: status.status }, files: [] }
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

    if (action.type === "handoff") {
      focus(entry, action.tabID)
      const requestID = crypto.randomUUID()
      const timeout = action.timeoutMs ?? 600_000

      const answer = await ask(entry, requestID, action.tabID, signal, timeout, () =>
        report(entry, { type: "handoff", tabID: action.tabID, requestID, reason: action.reason }),
      )

      // Timed out or cancelled: the window removes its prompt.
      if (answer?.type !== "handoff") report(entry, { type: "handoff.end", requestID })
      const current = inventory(entry).tabs.find((item) => item.id === action.tabID) ?? tab

      if (answer?.type === "handoff" && answer.done) return { value: { tab: current, done: true }, files: [] }

      return {
        value: { tab: current, done: false, reason: answer?.type === "handoff" ? "dismissed" : "timeout" },
        files: [],
      }
    }

    const page = entry.pages.get(action.tabID) ?? create(entry, true, undefined, tab)
    await page.ready
    const result = await page.execute(command, signal)
    publishState(entry)

    return result
  }

  /** Sends a question to the window and waits for its answer, the timeout, or cancellation. */
  async function ask(
    entry: Entry,
    requestID: string,
    tabID: Browser.TabID | undefined,
    signal: AbortSignal,
    timeoutMs: number,
    send: () => void,
  ) {
    const answer = Promise.withResolvers<Answer | undefined>()
    entry.answers.set(requestID, { tabID, resolve: answer.resolve })
    const timer = setTimeout(() => answer.resolve(undefined), timeoutMs)
    const cancel = () => answer.resolve(undefined)
    signal.addEventListener("abort", cancel, { once: true })
    send()

    try {
      return await answer.promise
    } finally {
      clearTimeout(timer)
      signal.removeEventListener("abort", cancel)
      entry.answers.delete(requestID)
    }
  }

  function focus(entry: Entry, tabID: Browser.TabID) {
    entry.focusedTabID = tabID
    publishState(entry)
    report(entry, { type: "focus", tabID })
  }
}
