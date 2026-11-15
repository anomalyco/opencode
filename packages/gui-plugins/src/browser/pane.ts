import { NodeHttpClient } from "@effect/platform-node"
import { Browser } from "@opencode/plugin-browser/rpc"
import { OpenCode } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import electron, { type BrowserWindow } from "electron"
import { Cause, Deferred, Effect, ManagedRuntime, Option, Queue, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds, Persisted, ServerEndpoints, Windows } from "@opencode/plugin/gui/main"
import { createBrowserPage, type BrowserPage, type Shared } from "./chromium"
import { browserFailure } from "./errors"
import { createBrowserNetwork, type BrowserNetwork } from "./network"
import { destinationOrigin, fileURLWithin, refusal } from "./policy"
import { createRefs } from "./refs"
import type { PaneEvent } from "./ipc"
import {
  attachmentFailure,
  createPaneState,
  decodeControl,
  decodeControlHeader,
  isCurrentPage,
  isFocusedPage,
  isPaneDisposed,
  resolveControlFrame,
  selectBinding,
  selectFileRoots,
  selectInventory,
  selectOwnedBinding,
  selectPageAttempt,
  selectTabSlot,
  transitionPane,
  type AttachmentOutcome,
  type BindingEvent,
  type PaneEffect,
  type PaneMachineEvent,
  type PaneState,
} from "./pane-machine"
import { createBrowserRestoreStore } from "./restore"

type Target = { readonly server: string; readonly session: string; readonly restore?: Browser.State }

/** The Electron and Effect handles of one binding; its phase lives in the pane machine. */
type Handle = {
  window: number
  win: BrowserWindow
  partition: string
  abort: AbortController
  registered: ReturnType<typeof Promise.withResolvers<void>>
  cleanup: () => void
  timer?: ReturnType<typeof setTimeout>
  network?: BrowserNetwork
  sendState?: (state: Browser.State) => void
  /** Pages by attempt. */
  pages: Map<number, BrowserPage>
  /** Agent requests in flight by request ID. */
  requests: Map<string, AbortController>
}

/** The pane machine's current state; only `dispatch` replaces it. */
type PaneMachine = { state: PaneState }

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
  const machine: PaneMachine = { state: createPaneState() }
  const handles = new Map<string, Handle>()
  const restore = createBrowserRestoreStore(input.storage)
  const shared: Shared = { ref: createRefs(input.refs) }
  // Page disposals in flight. Finishing a trace or CPU profile can hold a page open, and the pane's own disposal waits
  // for them so a replacement never starts beside old pages still recording.
  const releasing = new Set<Promise<void>>()
  const disposals = new WeakMap<BrowserPage, Promise<void>>()
  // Keep long-lived RPC requests off Chromium's shared HTTP connection pool.
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp)

  return {
    async register(window: number, binding: string, target: Target) {
      const server = input.serverEndpoints.get(target.server)

      if (isPaneDisposed(machine.state) || !server || !destinationOrigin(server.url))
        throw new Error("browser.pane.registration.invalid")

      const win = input.windows.get(window)

      if (!win || selectBinding(machine.state, binding) || handles.has(binding))
        throw new Error("browser.pane.owner.invalid")

      if (win.isDestroyed() || win.webContents.isDestroyed()) throw new Error("browser.pane.owner.unavailable")
      const sessionID = SessionID.make(target.session)
      const storageKey = `${target.server}\n${sessionID}`
      const partition = `opencode-browser-${crypto.randomUUID()}`

      // Navigation guards cover documents; subresources (img, script, fetch) also must not read
      // file: URLs outside the roots. One listener per partition covers every page in this attachment.
      electron.session
        .fromPartition(partition)
        .webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) =>
          callback({ cancel: !fileURLWithin(details.url, selectFileRoots(machine.state, binding)) }),
        )

      const closed = () => dispatchBinding(binding, { type: "owner.closed" })

      const navigate = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (event.isMainFrame && !event.isSameDocument) closed()
      }

      win.webContents.once("destroyed", closed)
      win.webContents.on("did-start-navigation", navigate)

      const handle: Handle = {
        window,
        win,
        partition,
        abort: new AbortController(),
        registered: Promise.withResolvers(),
        cleanup: () => {
          if (win.isDestroyed()) return
          win.webContents.off("destroyed", closed)
          win.webContents.off("did-start-navigation", navigate)
        },
        pages: new Map(),
        requests: new Map(),
      }

      handles.set(binding, handle)
      dispatch({
        type: "registered",
        binding,
        window,
        storageKey,
        restore: target.restore,
        saved: restore.load(storageKey),
      })
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

            // The agent can already read this workspace, so showing its files adds no access. A forwarded or explicit
            // loopback server does not share this machine's disk.
            const fileRoots = server.sameMachine ? [session.location.directory] : []

            const options = {
              location: { directory: session.location.directory, workspace: session.location.workspaceID },
            }

            const attachment = { sessionID, connectionID: crypto.randomUUID() }
            const rpc = client.rpc(Browser.Definition)
            handle.network = yield* createBrowserNetwork({ rpc, attachment, location: options.location, partition })
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

            // The window hears every event at once; it never waits on the server, which can stall for
            // hundreds of milliseconds while it serves the page's own traffic. The server's copy of the
            // inventory resolves every tab ID, so a state is retried until it arrives or the attachment
            // ends; the results queued behind it then never name a tab the server lacks. "unavailable"
            // means the server already dropped this attachment, which attach reports.
            handle.sendState = (state) =>
              send(
                rpc.state({ ...attachment, state }, options).pipe(
                  Effect.retry({
                    while: (error) => !("type" in error && error.type === "unavailable"),
                    schedule: Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("10 seconds")]),
                  }),
                ),
              )

            const run = (requestID: string, abort: AbortController) =>
              rpc.command({ ...attachment, requestID }, options).pipe(
                Effect.flatMap((command) =>
                  Effect.promise(async () => {
                    if ("tabID" in command.action)
                      dispatchBinding(binding, { type: "request.targeted", requestID, tabID: command.action.tabID })
                    reply(
                      requestID,
                      await execute(binding, command, abort.signal).then(
                        (result) => ({ type: "success" as const, result }),
                        (cause: unknown) => browserFailure(command.action, cause),
                      ),
                    )
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    handle.requests.delete(requestID)
                    dispatchBinding(binding, { type: "request.finished", requestID })
                  }),
                ),
                // An operation this desktop cannot decode comes from a newer plugin; answer it so
                // the agent does not wait out the server's timeout.
                Effect.tapError((error) =>
                  Effect.sync(() => {
                    if (!Schema.isSchemaError(error)) return
                    reply(requestID, {
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

            const receive = client.event.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "server.connected") {
                    yield* Deferred.succeed(connected, undefined)

                    return
                  }

                  if (event.type !== "rpc.experimental.browser.control") return

                  const frame = resolveControlFrame(
                    attachment.connectionID,
                    decodeControlHeader(event.data),
                    decodeControl(event.data),
                  )

                  if (frame.kind === "foreign") return

                  if (frame.kind === "attached") return dispatchBinding(binding, { type: "server.attached", fileRoots })

                  if (frame.kind === "incompatible") return dispatchBinding(binding, { type: "handshake.unsupported" })

                  // A newer server may add control events; this attachment keeps working without them.
                  if (frame.kind === "unrecognized")
                    return dispatchBinding(binding, { type: "control.unrecognized", controlType: frame.controlType })

                  if (frame.kind === "cancel")
                    return dispatchBinding(binding, { type: "request.cancelled", requestID: frame.requestID })
                  const abort = new AbortController()
                  handle.requests.set(frame.requestID, abort)
                  dispatchBinding(binding, { type: "request.started", requestID: frame.requestID })
                  yield* run(frame.requestID, abort)
                }),
              ),
            )

            return yield* Effect.raceAllFirst([
              receive,
              Stream.fromQueue(outbound).pipe(Stream.runForEach((send) => send)),
              Deferred.await(connected).pipe(Effect.andThen(rpc.attach({ ...attachment, version: 4 }, options))),
            ])
          }).pipe(
            Effect.matchCause({
              onSuccess: (result): AttachmentOutcome => (result === "replaced" ? "replaced" : "closed"),
              onFailure: (cause) =>
                Option.match(Cause.findErrorOption(cause), {
                  onNone: (): AttachmentOutcome => "closed",
                  onSome: attachmentFailure,
                }),
            }),
            // Inside the scope: closing the tunnels, the proxy and the partition's connections can take seconds, and
            // nothing that happens meanwhile changes why the attachment ended.
            Effect.tap((outcome) => Effect.sync(() => dispatchBinding(binding, { type: "attachment.ended", outcome }))),
            Effect.scoped,
          ),
          { signal: handle.abort.signal },
        )
        .catch(() => dispatchBinding(binding, { type: "attachment.ended", outcome: "closed" }))
      await handle.registered.promise

      if (!selectBinding(machine.state, binding)) throw new Error("browser.pane.registration.closed")
    },
    load(window: number, binding: string, tabID: Browser.TabID) {
      owned(window, binding)
      load(binding, tabID)
    },
    async inspect(window: number, binding: string, tabID: Browser.TabID, enabled: boolean) {
      owned(window, binding)
      await page(binding, tabID)?.inspect(enabled)
    },
    async highlight(window: number, binding: string, tabID: Browser.TabID, ref?: Browser.Ref) {
      owned(window, binding)
      await page(binding, tabID)?.highlight(ref)
    },
    zoom(window: number, binding: string, tabID: Browser.TabID, direction: "in" | "out" | "reset") {
      owned(window, binding)
      page(binding, tabID)?.zoom(direction)
    },
    async site(window: number, binding: string, tabID: Browser.TabID) {
      owned(window, binding)

      return (await page(binding, tabID)?.site()) ?? { cookies: 0 }
    },
    async clearSite(window: number, binding: string, tabID: Browser.TabID) {
      owned(window, binding)
      await page(binding, tabID)?.clearSite()
    },
    async command(window: number, binding: string, command: Browser.Action) {
      owned(window, binding)
      const url = command.type === "navigate" || command.type === "tabs.open" ? command.url : undefined

      // The window explains a refused address by its code; the agent's commands get main's own message instead.
      const reason =
        url === undefined ? undefined : refusal(url, { fileRoots: selectFileRoots(machine.state, binding) })

      if (reason) throw new Error(reason)
      // A navigation that the next one replaced, such as a second submit or a redirect, rejects with ERR_ABORTED while
      // the tab goes on loading. It is not a failed request; a page that fails to load reports its own error.
      await execute(binding, { action: command, files: [] }, new AbortController().signal).catch((error: Error) => {
        if (!("code" in error) || error.code !== "ERR_ABORTED") throw error
      })
    },
    async close(window: number, binding: string) {
      owned(window, binding)
      dispatchBinding(binding, { type: "client.closed" })
    },
    /**
     * The plugin is going away (reload, disable, or quit). Windows keep each pane's tabs as a
     * suspended attachment, like an idle server eviction, and register again once the pane is back.
     */
    async dispose() {
      dispatch({ type: "disposed" })
      await Promise.all(releasing)
      await runtime.dispose()
    },
  }

  function dispatch(event: PaneMachineEvent) {
    const next = transitionPane(machine.state, event)
    machine.state = next.state
    next.effects.forEach(perform)
  }

  function dispatchBinding(binding: string, event: BindingEvent) {
    dispatch({ type: "binding", binding, event })
  }

  function perform(effect: PaneEffect) {
    if (effect.type === "save-restore") return restore.save(effect.storageKey, effect.snapshot)

    if (effect.type === "remove-restore") return restore.remove(effect.storageKey)

    if (effect.type === "warn") return void runtime.runFork(Effect.logWarning(effect.message, effect.detail))
    const handle = handles.get(effect.binding)

    if (!handle) return

    if (effect.type === "start-timer") {
      handle.timer = setTimeout(() => dispatchBinding(effect.binding, { type: "register.timed-out" }), effect.ms)

      return
    }

    if (effect.type === "resolve-register") {
      clearTimeout(handle.timer)

      return handle.registered.resolve()
    }

    if (effect.type === "emit") return emit(effect.binding, effect.event)

    if (effect.type === "report") {
      emit(effect.binding, effect.event)

      return handle.sendState?.(effect.event.state)
    }

    if (effect.type === "abort-requests")
      return effect.requestIDs.forEach((requestID) => handle.requests.get(requestID)?.abort())

    if (effect.type === "release-pages")
      return effect.attempts.forEach((attempt) => {
        const page = handle.pages.get(attempt)
        handle.pages.delete(attempt)

        if (page) release(page)
      })
    handles.delete(effect.binding)
    clearTimeout(handle.timer)
    handle.registered.reject(new Error("browser.pane.registration.closed"))
    handle.cleanup()
    handle.abort.abort()
  }

  function owned(window: number, binding: string) {
    if (!selectOwnedBinding(machine.state, window, binding)) throw new Error("browser.pane.unavailable")
  }

  /** To the window only, while the binding's handle exists; a close event goes out before its teardown. */
  function emit(binding: string, event: PaneEvent) {
    const handle = handles.get(binding)

    if (!handle || handle.win.isDestroyed() || handle.win.webContents.isDestroyed()) return
    input.emit(handle.window, { binding, event })
  }

  function release(page: BrowserPage) {
    const done = page.dispose()
    const settled = done.catch(() => undefined)
    disposals.set(page, done)
    releasing.add(settled)
    void settled.finally(() => releasing.delete(settled))
  }

  function inventory(binding: string): Browser.State {
    const entry = selectBinding(machine.state, binding)

    return entry ? selectInventory(entry) : { tabs: [], focusedTabID: null }
  }

  /** The tab's current page. */
  function page(binding: string, tabID: Browser.TabID) {
    const attempt = selectPageAttempt(machine.state, binding, tabID)

    return attempt === undefined ? undefined : handles.get(binding)?.pages.get(attempt)
  }

  /** The tab's page, created the first time the pane shows a restored or crashed tab or a command names it. */
  function load(binding: string, tabID: Browser.TabID) {
    const existing = page(binding, tabID)

    if (existing) return existing
    const slot = selectTabSlot(machine.state, binding, tabID)

    if (slot?.status !== "unloaded") return undefined
    const tab = slot.tab

    // A crashed tab's error belongs to its last page; the new page reports its own.
    return create(binding, {
      restore: {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: tab.generation,
      },
    })
  }

  function create(
    binding: string,
    options: {
      readonly restore?: Browser.Tab
      readonly initialize?: boolean
      readonly popupOptions?: Electron.BrowserWindowConstructorOptions
    } = {},
  ) {
    const entry = selectBinding(machine.state, binding)
    const handle = handles.get(binding)

    if (entry?.status !== "attached" || !handle?.network)
      throw new Error("Browser network is not ready; no tab was opened.")
    const id = options.restore?.id ?? Browser.TabID.make(`tab_${crypto.randomUUID()}`)
    const attempt = entry.nextAttempt
    const win = handle.win
    // Every callback is fenced to this page: a later page of the same tab has another attempt.
    const current = () => isCurrentPage(machine.state, binding, id, attempt)
    const focused = () => isFocusedPage(machine.state, binding, id, attempt)

    const fail = () => {
      if (current())
        dispatchBinding(binding, {
          type: "tab.crashed",
          tabID: id,
          attempt,
          tab: page.contents.isDestroyed() ? undefined : page.state(),
        })
    }

    const page = createBrowserPage(win, {
      id,
      partition: handle.partition,
      network: handle.network,
      initialize: options.initialize,
      restore: options.restore,
      popupOptions: options.popupOptions,
      fileRoots: () => selectFileRoots(machine.state, binding),
      shared,
      embeds: input.embeds,
      fail,
      publish: (error) => {
        if (current()) dispatchBinding(binding, { type: "tab.published", tabID: id, attempt, tab: page.state(), error })
      },
      inspect: (event) => {
        if (current()) emit(binding, { type: "inspect", tabID: id, ...event })
      },
      // Icons and zoom are local to this desktop, and follow the states reported before them, so the window files a new
      // page's icon under that page's URL.
      detail: (value) => {
        if (current()) emit(binding, { type: "page", tabID: id, ...value })
      },
      zoomed: () => handles.get(binding)?.pages.forEach((page) => page.detail()),
      shortcut: (shortcut) => {
        if (!focused() || win.isDestroyed()) return

        // The page held keyboard focus; the command runs in the app, which may move focus there, as ⌘L does.
        if (win.isFocused()) win.webContents.focus()
        emit(binding, { type: "shortcut", ...shortcut })
      },
      focused: () => {
        if (focused()) emit(binding, { type: "focused", tabID: id })
      },
      popup: (popupOptions, background) => {
        const popup = create(binding, { initialize: false, popupOptions })

        if (!background) dispatchBinding(binding, { type: "tab.focused", tabID: popup.state().id })

        return popup.contents
      },
    })

    handle.pages.set(attempt, page)
    dispatchBinding(binding, { type: "tab.opened", tabID: id, attempt, tab: options.restore ?? page.state() })
    // Straight to the window, not through the server report: the embed is local to this desktop.
    emit(binding, { type: "embed", tabID: id, embed: page.embed })
    void page.ready.then(() => {
      if (current()) dispatchBinding(binding, { type: "tab.published", tabID: id, attempt, tab: page.state() })
    }, fail)

    return page
  }

  /** Reports the page's state after a command, which may have changed it without a page event yet. */
  function refresh(binding: string, tabID: Browser.TabID, page: BrowserPage) {
    const attempt = selectPageAttempt(machine.state, binding, tabID)

    if (attempt === undefined || handles.get(binding)?.pages.get(attempt) !== page) return
    dispatchBinding(binding, { type: "tab.published", tabID, attempt, tab: page.state() })
  }

  async function execute(binding: string, command: Browser.Command, signal: AbortSignal) {
    const action = command.action

    if (signal.aborted)
      throw new Error(
        "Browser request was cancelled. Do not repeat a mutating action until you have inspected its outcome.",
      )

    if (action.type === "tabs.list") return { value: inventory(binding), files: [] }

    if (action.type === "preview") {
      // The renderer owns file tabs; it resolves the path against the session's workspace.
      emit(binding, { type: "preview", path: action.path })

      return { value: { path: action.path }, files: [] }
    }

    if (action.type === "tabs.open") {
      const page = create(binding)
      const tabID = page.state().id

      if (action.focus !== false) dispatchBinding(binding, { type: "tab.focused", tabID })
      await page.ready

      // A new page already loads about:blank, so only another address needs a navigation.
      if (action.url !== undefined)
        await page.execute({ action: { type: "navigate", tabID, url: action.url }, files: [] }, signal)
      refresh(binding, tabID, page)

      return { value: page.state(), files: [] }
    }

    const slot = selectTabSlot(machine.state, binding, action.tabID)

    if (!slot)
      throw new Error(
        "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID from this session; a closed tab is not replaced automatically.",
      )

    if (action.type === "tabs.focus") {
      dispatchBinding(binding, { type: "tab.focused", tabID: action.tabID })

      return { value: slot.tab, files: [] }
    }

    if (action.type === "tabs.close") {
      const closing = page(binding, action.tabID)
      dispatchBinding(binding, { type: "tab.closed", tabID: action.tabID })

      if (closing) await disposals.get(closing)

      return { value: inventory(binding), files: [] }
    }

    const target = load(binding, action.tabID)

    if (!target) throw new Error("Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID.")
    await target.ready
    const result = await target.execute(command, signal)
    refresh(binding, action.tabID, target)

    return result
  }
}
