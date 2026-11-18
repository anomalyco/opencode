import { NodeHttpClient } from "@effect/platform-node"
import { homedir } from "node:os"
import { Browser } from "@opencode/plugin-browser/rpc"
import { OpenCode } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import electron, { type BrowserWindow } from "electron"
import { Cause, Deferred, Effect, ManagedRuntime, Option, Queue, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds, Persisted, ServerEndpoints, Windows } from "@opencode/plugin/gui/main"
import { createBrowserPage, type BrowserPage, type Shared } from "./chromium"
import { browserFailure, CodedError, missingArtifact, pageReports } from "./errors"
import { createBrowserNetwork, createDirectNetwork, type BrowserNetwork } from "./network"
import { activityOwner, agentDriven, agentRefusal, childActivity, createdActivity, destinationOrigin, normalizeURL, recordPageInput, recordTabFocus, refusal, restoreRefusal, type TabActivity } from "./policy"
import type { Profile } from "./profile"
import { createRefs } from "./refs"
import type { FindAction, PaneEvent, PromptAnswer, Viewport } from "./ipc"
import { createPageFind } from "./page-find"
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
import { createBrowserRestoreStore, restoredActivity } from "./restore"
import { createPasskeyGroups } from "./passkey-groups"
import { guardSession } from "./session-guard"
import { extensionResource } from "./profile/extension-api/resource"
import type { SitePermissions } from "./site-permissions"
import type { SystemMedia } from "./system-media"
import { workspaceFile, type WorkspaceSource } from "./workspace-file"
import { workspacePages } from "./workspace-pages"
import { FileVerificationError } from "@opencode/util/file-verification"
import { artifactKind } from "@opencode/util/artifact"
import { fileTab, reusableFile, workspaceFileURL } from "./link"
import { createPreviews } from "./profile/previews"
import { pluginTabs } from "./plugin-tabs"
import { remotePreview } from "./remote-preview"
import { artifactPages } from "./artifact-preview"
import { invalidReply, wireOutcome, wireState } from "./wire"

type Target = { readonly server: string; readonly session: string; readonly restore?: Browser.State }

/** The Electron and Effect handles of one binding; its phase lives in the pane machine. */
type Handle = {
  window: number
  win: BrowserWindow
  partition: string
  /** The pages browse in the desktop profile itself, with this machine's network; else in a linked partition. */
  shared: boolean
  workspace?: (activity: TabActivity, identity?: string) => ReturnType<typeof workspacePages>
  previewFailure: ReturnType<typeof createPreviews>["failure"]
  artifacts?: () => ReturnType<typeof artifactPages>
  source?: WorkspaceSource
  abort: AbortController
  registered: ReturnType<typeof Promise.withResolvers<void>>
  cleanup: () => void
  timer?: ReturnType<typeof setTimeout>
  network?: BrowserNetwork
  sendState?: (state: Browser.State) => void
  /** Pages by attempt. */
  pages: Map<number, BrowserPage>
  /**
   * Survives unloading the page, but not closing its tab or releasing the binding. A tab the agent drove is saved as
   * such, so it comes back agent-driven after a restart or a window reload.
   */
  activity: Map<Browser.TabID, TabActivity>
  background: Set<Browser.TabID>
  pluginTabs: ReturnType<typeof pluginTabs>
  /** Which tabs refuse passkeys together, by pop-up group; see `createPasskeyGroups`. */
  passkeys: ReturnType<typeof createPasskeyGroups>
  readonly storageKey: string
  /** Agent requests in flight by request ID. */
  requests: Map<string, AbortController>
}

/** The pane machine's current state; only `dispatch` replaces it. */
type PaneMachine = { state: PaneState }

export type Pane = ReturnType<typeof createBrowserPane>

export function createBrowserPane(input: {
  readonly windows: Windows
  readonly t: (key: string) => string
  readonly serverEndpoints: ServerEndpoints
  readonly storage: BuiltinMainStorage
  /** The declared store of reserved element refs. */
  readonly refs: Persisted<number, number>
  readonly embeds: Embeds
  /** The desktop browser's one profile: cookies, site data and extensions for every session. */
  readonly profile: Profile
  /** The permission decisions the user kept for sites. */
  readonly sites: SitePermissions
  /** The system's camera and microphone setting, and its prompt. */
  readonly system: SystemMedia
  /** Whether the build offers the device toolbar. */
  readonly toolbar: boolean
  readonly emit: (window: number, value: { readonly binding: string; readonly event: PaneEvent }) => void
}) {
  const machine: PaneMachine = { state: createPaneState() }
  const handles = new Map<string, Handle>()
  // Rebind may restore the same tabs. Close rights stay in memory and never move to another window or session.
  const owners = new WeakMap<BrowserWindow, Map<string, Pick<Handle, "pluginTabs" | "background">>>()
  // Release each tab's registration with the profile's extensions.
  const grants = new WeakMap<BrowserPage, () => void>()
  const searches = new WeakMap<BrowserPage, ReturnType<typeof createPageFind>>()
  // A second click can arrive before even about:blank has committed in the first click's new tab.
  const openingFiles = new WeakMap<BrowserPage, string>()
  const restore = createBrowserRestoreStore(input.storage)
  const shared: Shared = { ref: createRefs(input.refs) }
  // Page disposals in flight. Finishing a trace or CPU profile can hold a page open, and the pane's own disposal waits
  // for them so a replacement never starts beside old pages still recording.
  const releasing = new Set<Promise<void>>()
  const disposals = new WeakMap<BrowserPage, Promise<void>>()
  // Keep long-lived RPC requests off Chromium's shared HTTP connection pool.
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp)
  // Each page's download handler by its web contents ID. The profile guards its own session and owns this map; a remote
  // server's partition gets its own guard at registration, handing downloads to the same map.
  const downloads = input.profile.downloads
  // Warnings about Electron internals a page relies on, each logged once for the pane.
  const warned = new Set<string>()

  return {
    /**
     * The app menu's hard reload, offered while a pane of the window has a tab in front. It goes to the window, which
     * runs it on the pane it shows through `command`, so it is the person's command there and reaches a failed page.
     */
    menuReload(window: number | undefined) {
      const bindings = Array.from(handles).flatMap(([binding, handle]) =>
        handle.window === window && inventory(binding).focusedTabID ? [binding] : [],
      )

      return bindings.length ? () => bindings.forEach((binding) => emit(binding, { type: "hardReload" })) : undefined
    },
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
      const saved = restore.load(storageKey)
      // A server on this machine reaches the same network as this desktop, so its pages browse in the profile. Another
      // server's pages need its network through a proxy, which Chromium sets per partition.
      const shared = server.sameMachine
      const partition = shared ? input.profile.partition : `opencode-browser-${crypto.randomUUID()}`

      const remote = shared ? undefined : electron.session.fromPartition(partition)
      const abort = new AbortController()
      const previews = remote ? createPreviews(remote, abort.signal) : input.profile.previews
      const unguard = remote ? guardSession(remote, downloads, input.profile.permissions) : () => undefined

      const closed = () => dispatchBinding(binding, { type: "owner.closed" })

      const navigate = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (event.isMainFrame && !event.isSameDocument) closed()
      }

      win.webContents.once("destroyed", closed)
      win.webContents.on("did-start-navigation", navigate)

      const scopes = owners.get(win) ?? new Map<string, Pick<Handle, "pluginTabs" | "background">>()
      const rights = scopes.get(storageKey) ?? { pluginTabs: pluginTabs(), background: new Set<Browser.TabID>() }
      scopes.set(storageKey, rights)
      owners.set(win, scopes)

      const handle: Handle = {
        previewFailure: previews.failure,
        window,
        win,
        partition,
        shared,
        abort,
        registered: Promise.withResolvers(),
        cleanup: () => {
          unguard()

          if (win.isDestroyed()) return
          win.webContents.off("destroyed", closed)
          win.webContents.off("did-start-navigation", navigate)
        },
        pages: new Map(),
        activity: restoredActivity(saved),
        ...rights,
        passkeys: createPasskeyGroups(),
        storageKey,
        requests: new Map(),
      }

      handles.set(binding, handle)
      dispatch({
        type: "registered",
        binding,
        window,
        storageKey,
        restore: target.restore,
        saved,
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
            const builtin = server.id === "sidecar"
            const fileRoots = builtin ? [session.location.directory] : []

            const options = {
              location: { directory: session.location.directory, workspace: session.location.workspaceID },
            }

            const attachment = { sessionID, connectionID: crypto.randomUUID() }
            const rpc = client.rpc(Browser.Definition)

            const source: WorkspaceSource = builtin
              ? { type: "local", roots: () => selectFileRoots(machine.state, binding) }
              : remotePreview(server, sessionID, options.location, abort.signal)

            handle.source = source
            handle.artifacts = () => artifactPages(previews, server, session.location.directory, abort.signal)
            handle.workspace = (activity, identity) => workspacePages(previews, session.location.directory, source, abort.signal,
              () => agentDriven(activity) ? remotePreview(server, sessionID, options.location, abort.signal, {agent:activity.agent}) : undefined, identity)

            if (shared) handle.network = createDirectNetwork(input.profile.session)

            if (!shared) {
              handle.network = yield* createBrowserNetwork({ rpc, attachment, location: options.location, partition })
              // Only when the user chose to share sign-ins with remote servers do they carry over, both ways, so a page
              // of a remote server is signed in where the profile is; otherwise `link` leaves the partition apart.
              yield* Effect.acquireRelease(
                Effect.promise(() => input.profile.link(electron.session.fromPartition(partition))),
                (unlink) => Effect.sync(unlink),
              )
            }

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
                rpc.result({ ...attachment, requestID, outcome: wireOutcome(outcome) }, options).pipe(
                  // An older server can reject a locally valid result. Settle the same request, never rerun it.
                  Effect.catchIf(error => Schema.isSchemaError(error) || ("type" in error && error.type === "rpc.invalid_input"),
                    () => rpc.result({ ...attachment, requestID, outcome: invalidReply }, options)),
                ),
              )

            // The window hears every event at once; it never waits on the server, which can stall for
            // hundreds of milliseconds while it serves the page's own traffic. The server's copy of the
            // inventory resolves every tab ID, so a state is retried until it arrives or the attachment
            // ends; the results queued behind it then never name a tab the server lacks. "unavailable"
            // means the server already dropped this attachment, which attach reports.
            handle.sendState = (inventory) => {
              const state = wireState(inventory)

              if (!state) return send(Effect.logWarning("Browser state is not a valid wire inventory"))
              send(
                rpc.state({ ...attachment, state }, options).pipe(
                  Effect.retry({
                    while: (error) => !Schema.isSchemaError(error) && !("type" in error && ["unavailable", "rpc.invalid_input"].includes(error.type)),
                    schedule: Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("10 seconds")]),
                  }),
                ),
              )
            }

            const run = (requestID: string, abort: AbortController) =>
              rpc.command({ ...attachment, requestID }, options).pipe(
                Effect.flatMap((command) =>
                  Effect.promise(async () => {
                    if ("tabID" in command.action)
                      dispatchBinding(binding, { type: "request.targeted", requestID, tabID: command.action.tabID })
                    reply(
                      requestID,
                      await execute(binding, command, abort.signal, "agent").then(
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
                Effect.catchCause((cause) =>
                  Effect.sync(() => {
                    if (abort.signal.aborted) return
                    const error = Option.getOrUndefined(Cause.findErrorOption(cause))
                    reply(requestID, Schema.isSchemaError(error) ? {
                      type: "failure", code: "unsupported", message: "This desktop cannot decode the requested browser operation. Check the desktop and server versions.",
                    } : invalidReply)
                  }),
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
    toolbarTab(window: number, binding: string, tabID: Browser.TabID) {
      owned(window, binding)
      const target = page(binding, tabID)

      // The visible toolbar's menu temporarily covers its native view. Resolve the clicked binding and
      // selection, not view visibility or the window's last activation (which can be in another session).
      if (!target || !handles.get(binding)?.shared || inventory(binding).focusedTabID !== tabID) return

      return { id: target.nativeID, pageTop: target.areaTop() }
    },
    notice(window: number, binding: string, tabID: Browser.TabID, token: string, dismiss: boolean, copy?: boolean) {
      owned(window, binding)

      return page(binding, tabID)?.answerNotice(token, dismiss, copy)
    },
    async reviewLink(window: number, binding: string, url: string) {
      owned(window, binding)
      const focused = selectBinding(machine.state, binding)?.focusedTabID
      const tab = (focused && page(binding, focused)) || create(binding)
      const id = tab.state().id
      await tab.ready

      if (page(binding, id) !== tab) throw new Error("browser.pane.unavailable")
      dispatchBinding(binding, { type: "tab.focused", tabID: id })
      tab.reviewLink(url)

      return id
    },
    find(window: number, binding: string, tabID: Browser.TabID, action: FindAction) {
      owned(window, binding)
      const target = page(binding, tabID)

      if (!target) throw new Error("browser.pane.unavailable")
      searches.get(target)?.run(action)
    },
    async answer(window: number, binding: string, tabID: Browser.TabID, id: number, answer: PromptAnswer) {
      owned(window, binding)
      await page(binding, tabID)?.answer(id, answer)
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
    async setViewport(window: number, binding: string, tabID: Browser.TabID, viewport: Viewport) {
      owned(window, binding)
      const target = load(binding, tabID)

      if (!target) throw new Error("browser.pane.unavailable")
      await target.setViewport(viewport)
    },
    async site(window: number, binding: string, tabID: Browser.TabID) {
      owned(window, binding)

      return (await page(binding, tabID)?.site()) ?? { cookies: 0 }
    },
    async clearCache(window: number, binding: string, tabID: Browser.TabID, address: string) {
      owned(window, binding)
      const handle = handles.get(binding)
      const origin = destinationOrigin(address)
      const current = () => page(binding, tabID)?.contents.getURL() ?? selectTabSlot(machine.state, binding, tabID)?.tab.url

      if (!handle || !origin || destinationOrigin(current() ?? "") !== origin) throw new Error("browser.site.changed")
      page(binding, tabID)?.personCommand()
      const session = electron.session.fromPartition(handle.partition)
      await session.clearData({ origins: [origin], originMatchingMode: "origin-in-all-contexts", dataTypes: ["cache", "serviceWorkers"] })

      if (handle.abort.signal.aborted || destinationOrigin(current() ?? "") !== origin) return
      await execute(binding, { action: { type: "reload", tabID, ignoreCache: true }, files: [] }, handle.abort.signal, "user")
    },
    async clearSite(window: number, binding: string, tabID: Browser.TabID) {
      owned(window, binding)
      await page(binding, tabID)?.clearSite()
    },
    async reveal(window: number, binding: string, tabID: Browser.TabID) {
      owned(window, binding)
      const tab = page(binding, tabID)
      const url = tab?.state().url
      const file = url && await workspaceFile(url, selectFileRoots(machine.state, binding))

      if (!file || !tab || page(binding, tabID) !== tab || tab.state().url !== url) throw new Error("browser.address.workspace")
      // Reveal a regular file in its folder; never hand even a validated file to its executable association.
      electron.shell.showItemInFolder(file.path)
    },
    async openPage(window: number, binding: string, tabID: Browser.TabID, expected: string) {
      owned(window, binding)
      const tab = page(binding, tabID)

      if (!tab) throw new Error("browser.pane.unavailable")
      await tab.openPage(expected)
    },
    async command(window: number, binding: string, command: Browser.Action) {
      owned(window, binding)
      const url = command.type === "navigate" || command.type === "tabs.open" ? command.url : undefined

      // The window explains a refused address by its code; the agent's commands get main's own message instead.
      const reason =
        url === undefined
          ? undefined
          : refusal(url, pagePolicy(binding))

      if (reason) throw new Error(reason)

      if ("tabID" in command && command.type !== "tabs.focus") page(binding, command.tabID)?.personCommand()
      const closing = command.type === "tabs.close" ? page(binding, command.tabID) : undefined

      // A page that asks to confirm keeps its tab; its "Leave site?" closes it.
      if (closing && !(await closing.leave())) return
      // A navigation that the next one replaced, such as a second submit or a redirect, rejects with ERR_ABORTED while
      // the tab goes on loading; one the person stopped, or that became a download, commits no page; a slow one
      // outlives the command's deadline. None is a failed command, and a page that fails to load reports its own
      // error, which the window shows where the page would be.
      await execute(binding, { action: command, files: [] }, new AbortController().signal, "user", "present").catch(
        (error: Error) => {
          if (error instanceof FileVerificationError) throw new Error(error._tag)

          if (!pageReports(error)) throw error
        },
      )
    },
    async close(window: number, binding: string) {
      owned(window, binding)
      dispatchBinding(binding, { type: "owner.closed" })
    },
    async createTab(window: number, binding: string, owner: string, url: string) {
      owned(window, binding)
      const handle = handles.get(binding)

      if (!handle) throw new Error("browser.pane.unavailable")
      const grant = handle.pluginTabs.reserve(owner)
      // Never adopt an existing file tab, even when this plugin opens the same URL as the user.
      await execute(binding, { action: { type: "tabs.open", url }, files: [] }, handle.abort.signal, "user", "new", undefined, grant.created)
      grant.settled()

      return grant.id
    },
    async closeTab(window: number, binding: string, owner: string, id: string) {
      owned(window, binding)
      const tabID = handles.get(binding)?.pluginTabs.resolve(owner, id)

      if (!tabID || !selectTabSlot(machine.state, binding, tabID)) return false
      const closing = page(binding, tabID)

      if (closing && !(await closing.leave())) return false

      if (handles.get(binding)?.pluginTabs.resolve(owner, id) !== tabID) return false
      dispatchBinding(binding, { type: "tab.closed", tabID })

      return true
    },
    forget(server: string, session: string) {
      const storageKey = `${server}\n${session}`

      for (const binding of handles.keys()) {
        if (selectBinding(machine.state,binding)?.storageKey === storageKey) dispatchBinding(binding,{type:"client.closed"})
      }

      restore.remove(storageKey)
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
    if (event.type === "tab.closed") {
      handles.get(binding)?.activity.delete(event.tabID)
      handles.get(binding)?.background.delete(event.tabID)
      handles.get(binding)?.pluginTabs.forget(event.tabID)
      handles.get(binding)?.passkeys.remove(event.tabID)
    }

    dispatch({ type: "binding", binding, event })

    // Extensions hear which tab is active in a window.
    if (event.type === "tab.focused" && handles.get(binding)?.shared) {
      const focused = page(binding, event.tabID)

      if (focused) input.profile.extensionTabs.activated(focused.contents.id)
    }
  }

  function perform(effect: PaneEffect) {
    if (effect.type === "save-restore") {
      const activities = Array.from(handles.values()).flatMap((handle) => (handle.storageKey === effect.storageKey ? [handle.activity] : []))

      return restore.save(effect.storageKey, effect.snapshot, (tabID) =>
        activities.map((activity) => activity.get(tabID)).find((tab) => !!tab && agentDriven(tab)),
      )
    }

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

      return handle.sendState?.(inventory(effect.binding, "agent"))
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

  /** Extensions whose pages may open in the binding's tabs: the profile's, which only the profile partition loads. */
  function extensions(binding: string) {
    return handles.get(binding)?.shared ? input.profile.extensionIDs() : []
  }

  function release(page: BrowserPage) {
    try {
      searches.get(page)?.dispose()
      input.profile.permissions.delete(page.nativeID)
      grants.get(page)?.()
      downloads.delete(page.nativeID)
    } finally {
      const done = page.dispose()
      const settled = done.catch(() => undefined)
      disposals.set(page, done)
      releasing.add(settled)
      void settled.finally(() => releasing.delete(settled))
    }
  }

  function inventory(binding: string, audience: "window" | "agent" = "window"): Browser.State {
    const entry = selectBinding(machine.state, binding)

    return entry ? selectInventory(entry, audience) : { tabs: [], focusedTabID: null }
  }

  function remoteSource(binding: string) {
    const source = handles.get(binding)?.source

    return source?.type === "remote" ? source : undefined
  }

  function pagePolicy(binding: string) {
    return { fileRoots: selectFileRoots(machine.state, binding), extensions: extensions(binding), home: homedir(), remote: remoteSource(binding)?.prefix, artifacts: true }
  }

  /** The tab's current page. */
  function page(binding: string, tabID: Browser.TabID) {
    const attempt = selectPageAttempt(machine.state, binding, tabID)

    return attempt === undefined ? undefined : handles.get(binding)?.pages.get(attempt)
  }

  /** The tab's page, created the first time the pane shows a restored or crashed tab or a command names it. */
  function load(binding: string, tabID: Browser.TabID, identity?: string, navigateTo?: string) {
    const existing = page(binding, tabID)

    if (existing) return existing
    const slot = selectTabSlot(machine.state, binding, tabID)

    if (slot?.status !== "unloaded") return undefined
    const tab = slot.tab
    const denied = restoreRefusal(tab.url, pagePolicy(binding))

    if (denied && navigateTo === undefined) {
      dispatchBinding(binding, { type: "restore.refused", tabID, reason: denied })
      throw new CodedError(Browser.FailureCode.previewUnavailable, denied === "browser.restore.outside" ? "This file is now outside the session’s workspace. Open a file in the current workspace instead." : "This saved address is no longer allowed in this session.")
    }

    // The user can replace the refused address. Check the replacement before allocating even a blank page.
    if (denied && navigateTo !== undefined) normalizeURL(navigateTo, pagePolicy(binding))

    // A crashed tab's error belongs to its last page; the new page reports its own.
    return create(binding, {
      identity,
      restore: {
        id: tab.id,
        url: denied ? "about:blank" : tab.url,
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
      readonly activity?: TabActivity
      readonly identity?: string
      /** The tab whose page opened this one, which joins its pop-up group. */
      readonly opener?: Browser.TabID
    } = {},
  ) {
    const entry = selectBinding(machine.state, binding)
    const handle = handles.get(binding)

    if (entry?.status !== "attached" || !handle?.network)
      throw new Error("Browser network is not ready; no tab was opened.")
    const id = options.restore?.id ?? Browser.TabID.make(`tab_${crypto.randomUUID()}`)
    // Whoever makes the tab says whose it is (`createdActivity`). An agent command running in another tab does not.
    const activity = handle.activity.get(id) ?? options.activity ?? { agentRuns: 0 }
    handle.activity.set(id, activity)
    handle.passkeys.join(id, options.opener)
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
      activity,
      userInput: () => { if (current()) handle.pluginTabs.forget(id) },
      passkeysRestricted: () => handle.passkeys.restricted(id),
      // Every page of the group refuses from now on, or fails where it cannot; one created later refuses from its first
      // document.
      restrictPasskeys: () =>
        handle.passkeys.restrict(id).forEach((tabID) => {
          const attempt = selectPageAttempt(machine.state, binding, tabID)

          if (attempt !== undefined) void handle.pages.get(attempt)?.restrictPasskeys().catch(() => undefined)
        }),
      partition: handle.partition,
      network: handle.network,
      initialize: options.initialize,
      restore: options.restore,
      popupOptions: options.popupOptions,
      fileRoots: () => selectFileRoots(machine.state, binding),
      workspace: handle.workspace?.(activity, options.identity),
      previewFailure: handle.previewFailure,
      artifacts: handle.artifacts?.(),
      remote: remoteSource(binding),
      local: handle.shared,
      waitForFilters: handle.shared ? input.profile.waitForFilters : undefined,
      signal: handle.abort.signal,
      extensions: () => extensions(binding),
      shared,
      menu: {
        t: input.t,
        extensions: (contents, params) => handle.shared ? input.profile.extensionMenu(contents, params) : [],
        navigate: async (type) => {
          const action = type === "hardReload" ? { type: "reload", tabID: id, ignoreCache: true } as const : { type, tabID: id }

          if (current()) await execute(binding, { action, files: [] }, handle.abort.signal, "user")
        },
        open: async (url) => { if (current()) await execute(binding, { action: { type: "tabs.open", url }, files: [] }, handle.abort.signal, "user", "new", childActivity(activity)) },
      },
      embeds: input.embeds,
      sites: input.sites,
      serverPartition: !handle.shared,
      prompt: (view) => {
        if (!current()) return

        // The page held the keyboard; the window's document takes it, so the prompt can.
        if (view?.focus && focused() && win.isFocused()) win.webContents.focus()
        emit(binding, { type: "prompt", tabID: id, prompt: view })
      },
      closeTab: () => {
        if (current()) dispatchBinding(binding, { type: "tab.closed", tabID: id })
      },
      focusPage: () => {
        if (focused() && win.isFocused() && page.view.getVisible()) page.contents.focus()
      },
      front: () => focused() && win.isFocused(),
      system: input.system,
      warn: (message) => {
        if (warned.has(message)) return
        warned.add(message)
        void runtime.runFork(Effect.logWarning(message))
      },
      fail,
      refused: (notice, token, site) => {
        if (current()) emit(binding, { type: "refusal", tabID: id, notice, token, site })
      },
      publish: (error) => {
        if (current()) dispatchBinding(binding, { type: "tab.published", tabID: id, attempt, tab: page.state(), error })
      },
      inspect: (event) => {
        if (current()) emit(binding, { type: "inspect", tabID: id, ...event })
      },
      // The window files the icon under the URL from the preceding inventory update.
      detail: (value) => {
        if (current()) emit(binding, { type: "page", tabID: id, ...value })
      },
      zoomed: () => handles.get(binding)?.pages.forEach((page) => page.detail()),
      toolbar: input.toolbar,
      shortcut: (shortcut) => {
        if (!focused() || win.isDestroyed()) return
        page.focusHost()
        emit(binding, { type: "shortcut", ...shortcut })
      },
      focused: () => {
        if (focused()) emit(binding, { type: "focused", tabID: id })
      },
      hidden: () => {
        if (handle.shared) input.profile.extensionTabs.hidden(page.contents.id)
      },
      popup: (popupOptions, background, activity) => {
        const popup = create(binding, { initialize: false, popupOptions, activity, opener: id })

        if (activityOwner(activity) === "agent") {
          announce(binding, popup.state().id, "none", !background)

          return popup.contents
        }

        if (!background) dispatchBinding(binding, { type: "tab.focused", tabID: popup.state().id })

        return popup.contents
      },
    })

    // Construction succeeded; take ownership before registering with the profile, machine or window.
    using registering = new DisposableStack()
    registering.defer(() => {
      if (current()) return dispatchBinding(binding, { type: "tab.crashed", tabID: id, attempt })
      handle.pages.delete(attempt)
      release(page)
    })
    void page.ready.catch(() => undefined)

    if (handle.shared) {
      grants.set(page, input.profile.extensionTabs.register(extensionTab(binding, id, page, win, focused)))
    }

    handle.pages.set(attempt, page)
    searches.set(page, createPageFind(page.contents, (view) => {
      if (current()) emit(binding, { type: "find", tabID: id, view })
    }, () => {
      if (focused() && win.isFocused() && page.view.getVisible()) page.contents.focus()
    }))
    downloads.set(page.contents.id, page.download)
    input.profile.permissions.set(page.contents.id, page.permissions)
    dispatchBinding(binding, { type: "tab.opened", tabID: id, attempt, tab: options.restore ?? page.state() })
    // Straight to the window, not through the server report: the embed is local to this desktop.
    emit(binding, { type: "embed", tabID: id, embed: page.embed })
    void page.ready.then(() => {
      if (current()) dispatchBinding(binding, { type: "tab.published", tabID: id, attempt, tab: page.state() })
    }, fail)

    registering.move()

    return page
  }

  /**
   * A tab as extensions drive it, through the same paths and address policy as the window's and the agent's commands:
   * `chrome.tabs.create` opens a tab in this pane, `update` navigates or focuses it, `remove` closes it.
   */
  function extensionTab(
    binding: string,
    tabID: Browser.TabID,
    page: BrowserPage,
    win: BrowserWindow,
    focused: () => boolean,
  ) {
    const guarded = (url: string, caller: string) => {
      if (URL.parse(url)?.protocol === "chrome-extension:" && !extensionResource(url, `chrome-extension://${caller}`, (id) => page.contents.session.extensions.getExtension(id)))
        throw new Error("Extensions can open only their own extension pages.")

      if (/^file:/i.test(url)) throw new Error("Extensions do not have file access.")
      const reason = refusal(url, { fileRoots: selectFileRoots(machine.state, binding), extensions: extensions(binding) })

      if (reason) throw new Error(`This browser does not open ${url}.`)

      return url
    }

    return {
      contents: page.contents,
      window: win,
      focused,
      open: async (url: string, active: boolean, caller: string) => {
        const opened = await execute(
          binding,
          { action: { type: "tabs.open", url: guarded(url, caller), focus: active }, files: [] },
          new AbortController().signal,
          "user",
          "new",
          page.childActivity(),
        )

        const created = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Struct({ id: Browser.TabID }))(opened.value))
        const contents = created ? load(binding, created.id)?.contents : undefined

        if (!contents) throw new Error("The tab did not open.")

        return contents
      },
      focus: () => dispatchBinding(binding, { type: "tab.focused", tabID }),
      close: () => dispatchBinding(binding, { type: "tab.closed", tabID }),
      navigate: async (url: string, caller: string) => {
        await execute(
          binding,
          { action: { type: "navigate", tabID, url: guarded(url, caller) }, files: [] },
          new AbortController().signal,
          "user",
        )
      },
    }
  }

  /** Reports the page's state after a command, which may have changed it without a page event yet. */
  function announce(binding: string, tabID: Browser.TabID, reveal: "none" | "pane" | "tab", active: boolean) {
    if (active) dispatchBinding(binding, { type: "tab.active", tabID })
    const handle = handles.get(binding)

    // A hidden or minimized window hears it too: its model selects the tab, so the page shows when the person returns.
    if (handle) emit(binding, { type: "activity", tabID, reveal: handle.background.has(tabID) ? "none" : reveal })
  }

  function refresh(binding: string, tabID: Browser.TabID, page: BrowserPage) {
    const attempt = selectPageAttempt(machine.state, binding, tabID)

    if (attempt === undefined || handles.get(binding)?.pages.get(attempt) !== page) return
    dispatchBinding(binding, { type: "tab.published", tabID, attempt, tab: page.state() })
  }

  async function execute(binding: string, command: Browser.Command, signal: AbortSignal, origin: "agent" | "user", intent: "present" | "new" = "new", inherited?: TabActivity, created?: (id: Browser.TabID) => void): Promise<Browser.Result> {
    const action = command.action

    const present = (tabID: Browser.TabID, reveal: "none" | "pane" | "tab" = "none", active = true) => {
      if (origin === "user") return dispatchBinding(binding, { type: "tab.focused", tabID })
      announce(binding, tabID, reveal, active)
    }

    // A user preview may already have consumed files that the agent may not read. Revoke its origins and
    // discard the complete WebContents before handing the agent a target; rechecking only future fetches is too late.
    const acquire = (id: Browser.TabID) => {
      if (origin !== "agent") return load(binding, id, undefined, action.type === "navigate" ? action.url : undefined)
      const handle = handles.get(binding)
      const activity = handle?.activity.get(id) ?? { agentRuns: 0 }
      const changed = !agentDriven(activity) || activity.agent !== command.agent
      const current = page(binding, id)
      const identity = current?.previewIdentity()
      handle?.pluginTabs.forget(id)
      recordPageInput(activity, "agent")
      activity.agent = command.agent
      handle?.activity.set(id, activity)

      if (changed && current?.previewUsed()) dispatchBinding(binding, {type:"tab.restricted", tabID:id, url:current.state().url})

      // The agent may only focus the tab, which runs no command on its page: the refusal starts now all the same, and
      // where it cannot, the page fails.
      void current?.restrictPasskeys().catch(() => undefined)

      return load(binding, id, identity)
    }

    if (signal.aborted)
      throw new Error(
        "Browser request was cancelled. Do not repeat a mutating action until you have inspected its outcome.",
      )

    if (action.type === "tabs.list") return { value: inventory(binding, origin === "agent" ? "agent" : "window"), files: [] }

    // The address a tab loads this workspace file from, once the session is known to read it still.
    const fileURL = async (path: string) => {
      const roots = selectFileRoots(machine.state, binding)
      const remote = remoteSource(binding)
      const url = remote ? `${remote.prefix}${path.split("/").map(encodeURIComponent).join("/")}` : roots[0] && workspaceFileURL(roots[0], path)

      if (!url || !(remote ? Number.isSafeInteger(await remote.stat(path, signal, path, true)) : await workspaceFile(url, roots)))
        throw new CodedError(Browser.FailureCode.previewUnavailable, remote?.needsUpdate?.() ? "Update this session's server to open workspace files in the browser." : "The workspace file no longer exists or cannot be read by this session.")
      signal.throwIfAborted()
      normalizeURL(url, pagePolicy(binding))

      return url
    }

    if (action.type === "preview") {
      if (artifactKind(action.path) === "html") {
        const url = await fileURL(action.path)
        const existing = fileTab(inventory(binding).tabs, url)

        if (existing) handles.get(binding)?.pluginTabs.forget(existing.id)
        const tab = existing ? acquire(existing.id) : create(binding, { activity: createdActivity(origin, command.agent) })

        if (!tab) throw new Error("Workspace preview tab is unavailable.")
        using opening = new DisposableStack()
        const tabID = tab.state().id

        if (!existing) opening.defer(() => { if (page(binding, tabID) === tab) dispatchBinding(binding, { type: "tab.closed", tabID }) })
        await tab.execute({ action: { type: "navigate", tabID, url }, files: [] }, signal, origin)
        refresh(binding, tabID, tab)
        // A workspace file is opened to show it to the person: it takes the pane even when another tab is selected there.
        present(tabID, "tab")
        opening.move()

        return { value: { path: action.path, tabID, url: tab.state().url, tab: tab.state() }, files: [] }
      }

      // The window owns file tabs; an off-screen session processes this request when its file panel mounts.
      const win = handles.get(binding)?.win

      if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) emit(binding, { type: "preview", path: action.path })

      return { value: { path: action.path }, files: [] }
    }

    if (action.type === "tabs.open") {
      // The page refuses the agent's navigation to an extension page too; refusing first leaves no blank tab behind.
      const refused = origin === "agent" ? agentRefusal(action, { url: "about:blank", origin: "null" }) : undefined

      if (refused) throw new Error(refused)

      if (action.url !== undefined) normalizeURL(action.url, pagePolicy(binding))

      if (action.url?.startsWith("artifact:")) {
        const available = await handles.get(binding)?.artifacts?.().exists(action.url)
        signal.throwIfAborted()

        if (!available) throw origin === "agent" ? missingArtifact() : new Error("browser.artifact.missing")
      }

      const file = reusableFile(action.url, intent)

      if (file) {
        const existing = inventory(binding).tabs.find((tab) => {
          const live = page(binding, tab.id)

          return tab.url.split(/[?#]/, 1)[0] === file || (!!live && openingFiles.get(live) === file)
        })

        if (existing) {
          dispatchBinding(binding, { type: "tab.focused", tabID: existing.id })

          return { value: existing, files: [] }
        }
      }

      const opened = create(binding, { activity: createdActivity(origin, command.agent, inherited) })
      const tabID = opened.state().id

      if (origin === "agent" && action.focus === false) handles.get(binding)?.background.add(tabID)
      created?.(tabID)
      using opening = new DisposableStack()
      opening.defer(() => { if (page(binding, tabID) === opened) dispatchBinding(binding, { type: "tab.closed", tabID }) })

      if (file) openingFiles.set(opened, file)

      if (origin === "user" && action.focus !== false) present(tabID)

      try {
        await opened.ready

        // A new page already loads about:blank, so only another address needs a navigation.
        if (action.url !== undefined)
          await opened.execute({ action: { type: "navigate", tabID, url: action.url }, files: [] }, signal, origin)
        refresh(binding, tabID, opened)

        if (origin === "agent") present(tabID, action.focus === true ? "pane" : "none", action.focus !== false)
        opening.move()

        return { value: opened.state(), files: [] }
      } finally {
        openingFiles.delete(opened)
      }
    }

    const slot = selectTabSlot(machine.state, binding, action.tabID)

    if (!slot)
      throw new Error(
        "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID from this session; a closed tab is not replaced automatically.",
      )

    if (action.type === "tabs.focus") {
      const restricted = origin === "agent" ? acquire(action.tabID) : undefined
      await restricted?.ready
      const activities = handles.get(binding)?.activity
      const activity = activities?.get(action.tabID) ?? { agentRuns: 0 }

      recordTabFocus(activity, origin)
      activities?.set(action.tabID, activity)

      if (origin === "user") {
        handles.get(binding)?.background.delete(action.tabID)
        dispatchBinding(binding, { type: "tab.focused", tabID: action.tabID, fromStrip: true })
      }

      if (origin === "agent") present(action.tabID)

      return { value: restricted?.state() ?? slot.tab, files: [] }
    }

    if (action.type === "tabs.close") {
      const closing = page(binding, action.tabID)
      dispatchBinding(binding, { type: "tab.closed", tabID: action.tabID })

      if (closing) await disposals.get(closing)

      return { value: inventory(binding, origin === "agent" ? "agent" : "window"), files: [] }
    }

    const url = action.type === "navigate.path" ? await fileURL(action.path) : undefined

    if (action.type === "navigate" || action.type === "navigate.path" || action.type === "back" || action.type === "forward" || action.type === "reload")
      handles.get(binding)?.pluginTabs.forget(action.tabID)
    const target = acquire(action.tabID)

    if (!target) throw new Error("Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID.")

    // The same navigation as a web address, checks on the tab's generation and site included, and shown as a file is.
    if (action.type === "navigate.path" && url) {
      await target.execute({ ...command, action: { type: "navigate", tabID: action.tabID, url } }, signal, origin)
      refresh(binding, action.tabID, target)
      present(action.tabID, "tab")

      return { value: { path: action.path, tabID: action.tabID, url: target.state().url, tab: target.state() }, files: [] }
    }

    const result = await target.execute(command, signal, origin)
    refresh(binding, action.tabID, target)

    if (origin === "agent" && action.type === "navigate") present(action.tabID, "none", false)

    return result
  }
}
