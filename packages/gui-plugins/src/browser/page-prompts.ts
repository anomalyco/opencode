import { systemPreferences, type WebContents } from "electron"
import { Browser } from "@opencode/plugin-browser/rpc"
import { CodedError } from "./errors"
import type { DialogInfo } from "./dialog-machine"
import { PROMPT_TEXT_MAX, type PromptAnswer, type PromptView } from "./ipc"
import {
  initialPrompts,
  promptHost,
  promptSite,
  promptText,
  selectPrompt,
  selectPrompted,
  transitionPrompts,
  type PromptEvent,
  type Waiting,
  type WaitingRequest,
} from "./prompt-machine"
import { challengeAnswer } from "./site-auth"
import {
  clipboardWrite,
  originOf,
  keptApplies,
  permissionKinds,
  requesterOrigin,
  siteAnswer,
  type PermissionKind,
  type SitePermissions,
} from "./site-permissions"

/** How long a request that arrives while an agent command runs in the tab waits for the user before the page is told no. */
export const AGENT_PROMPT_WAIT_MS = 20_000

/**
 * How long a user's navigation stays the user's for its page's beforeunload. Chromium asks the page after the command
 * that started it may have ended: a dialog the page opens ends the command's wait.
 */
const INTENT_MS = 10_000

/** How long closing a tab waits for the page's beforeunload before it closes anyway. */
const LEAVE_PROBE_MS = 3_000

/** A user navigation the page may hold back; "Leave" runs it again. */
export type LeaveAction = { readonly type: "close" } | Browser.Action

/** A scripted dialog the user may answer, as the dialog gate holds it. */
type OpenDialog = { readonly revision: number; readonly url: string; readonly dialog: DialogInfo; readonly repeat?: boolean }

/** A permission request's or check's details, as Electron's session handlers give them. */
type Details = {
  readonly requestingUrl?: string
  readonly securityOrigin?: string
  readonly isMainFrame: boolean
  readonly mediaTypes?: readonly string[]
  readonly mediaType?: string
}

/** What Electron's `-run-dialog` event carries; the dialog's content comes from CDP instead. */
type RunDialogInfo = { readonly dialogType: string }

/** What the session guard calls for a web page of a tab. */
export type PagePermissions = {
  request(permission: string, details: Details, callback: (granted: boolean) => void): void
  check(permission: string, origin: string, details: Details): boolean
}

/**
 * Everything a tab asks its user: page dialogs (through the dialog gate), "Leave site?", site permissions, a site's
 * sign-in, and devices the system refused. The window receives only the prompt's view; answers come only from the
 * window, so no agent tool can read or answer one. Every waiting callback gets exactly one answer, at the latest when
 * the page navigates away or closes.
 */
export function createPagePrompts(input: {
  readonly contents: WebContents
  /** The page browses in a remote server's partition. */
  readonly remote: boolean
  readonly sites: SitePermissions
  /** The agent caused what happens in the tab now (gentCaused in policy.ts). */
  readonly agentCaused: () => boolean
  /** The tab's top-level address as the pane shows it, so a preview reads as its file. */
  readonly top: () => string
  readonly dialog: () => OpenDialog | null
  readonly answerDialog: (revision: number, answer: Extract<PromptAnswer, { kind: "dialog" }>) => Promise<void>
  /** Runs a user navigation again after the user chose to leave. */
  readonly redo: (action: Browser.Action) => Promise<void>
  /** Closes the tab after the user chose to leave it. */
  readonly close: () => void
  /** Gives the page keyboard focus back when its tab is in front. */
  readonly focusPage: () => void
  readonly report: (view: PromptView | null) => void
}) {
  const contents = input.contents
  let state = initialPrompts
  // The callbacks each waiting item answers, by its id; a joined request adds its own.
  const permissionCallbacks = new Map<number, ((granted: boolean) => void)[]>()
  const authCallbacks = new Map<number, ((username?: string, password?: string) => void)[]>()
  const leaveActions = new Map<number, LeaveAction>()
  const deadlines = new Map<number, ReturnType<typeof setTimeout>>()
  // This visit's decisions, by origin and feature, until the tab leaves the origin or closes.
  const visit = new Map<string, "allow" | "block">()
  const attempts = new Map<string, number>()
  // Agent commands running now, which a sign-in the user must answer stops with a clear error.
  const agentWaits = new Set<(error: Error) => void>()
  // The user's last navigation or close, while Chromium may still ask its page's beforeunload about it.
  let intent: { action: LeaveAction; at: number } | undefined
  let bypass = false
  let pending: string | undefined
  let committedOrigin = contents.mainFrame.origin
  let reported = "null"
  let disposed = false

  // A remote server's own machine never reads this desktop's kept decisions, nor writes them (see keptApplies).
  const decided = (origin: string) => (kind: PermissionKind) =>
    visit.get(`${origin}\n${kind}`) ?? (keptApplies(origin, input.remote) ? input.sites.get(origin, kind) : undefined)

  const dispatch = (event: PromptEvent) => {
    const next = transitionPrompts(state, event)
    state = next.state
    next.ended.forEach((id) => end(id))

    return next
  }

  const enqueue = (request: WaitingRequest) => {
    const result = dispatch({ type: "requested", request })
    publish()

    return result.id ?? 0
  }

  // A deadline, a navigation or a close ends an item with the page's default answer, never leaving it hanging.
  const end = (id: number) => {
    clearTimeout(deadlines.get(id))
    deadlines.delete(id)
    permissionCallbacks.get(id)?.forEach((callback) => callback(false))
    permissionCallbacks.delete(id)
    authCallbacks.get(id)?.forEach((callback) => callback())
    authCallbacks.delete(id)
    leaveActions.delete(id)
  }

  const settle = (id: number) => {
    clearTimeout(deadlines.get(id))
    deadlines.delete(id)
    dispatch({ type: "settled", id })
    publish()
  }

  const publish = () => {
    if (disposed) return
    const next = view()
    const key = JSON.stringify(next && { ...next, focus: false })

    if (key === reported) return
    reported = key
    input.report(next)
  }

  const view = (): PromptView | null => {
    const dialog = input.dialog()
    const head = selectPrompt(state)
    const waiting = state.items.length + (dialog ? 1 : 0) - 1
    // What the agent caused never takes the user's focus.
    const focus = !contents.isDestroyed() && contents.isFocused() && !input.agentCaused()

    if (dialog)
      return {
        id: dialog.revision,
        waiting,
        focus,
        ask: {
          kind: "dialog",
          dialog: dialog.dialog.type === "confirm" || dialog.dialog.type === "prompt" ? dialog.dialog.type : "alert",
          site: promptSite(dialog.url, input.top()),
          message: promptText(dialog.dialog.message, PROMPT_TEXT_MAX),
          value: promptText(dialog.dialog.defaultValue, PROMPT_TEXT_MAX),
          stop: !!dialog.repeat,
        },
      }

    if (!head) return null

    return { id: head.id, waiting, focus, ask: ask(head) }
  }

  const ask = (item: Waiting): PromptView["ask"] => {
    if (item.kind === "permission")
      return {
        kind: "permission",
        site: promptSite(item.origin, item.origin),
        permissions: item.permissions,
        remember: item.remember,
      }

    if (item.kind === "auth") return { kind: "auth", host: item.host, realm: item.realm, failed: item.failed }

    if (item.kind === "system")
      return {
        kind: "system",
        device: item.device,
        platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "other",
      }

    return { kind: "leave" }
  }

  // Grants a feature the user allowed, unless the system's privacy settings refuse this app the device.
  const grant = (kinds: readonly PermissionKind[], callback: (granted: boolean) => void) => {
    const blocked = kinds.find((kind): kind is "camera" | "microphone" => (kind === "camera" || kind === "microphone") && !device(kind))

    if (!blocked) return void callback(true)

    if (process.platform === "darwin" && blocked === "microphone" && systemPreferences.getMediaAccessStatus("microphone") === "not-determined")
      return void systemPreferences.askForMediaAccess("microphone").then((granted) => {
        if (granted && kinds.every((kind) => kind !== "camera" || device("camera"))) return callback(true)
        callback(false)

        if (!granted && !disposed) enqueue({ kind: "system", key: "system\nmicrophone", device: "microphone" })
      }, () => callback(false))
    callback(false)
    enqueue({ kind: "system", key: `system\n${blocked}`, device: blocked })
  }

  const login = (
    event: Electron.Event,
    details: Electron.AuthenticationResponseDetails,
    auth: Electron.AuthInfo,
    callback: (username?: string, password?: string) => void,
  ) => {
    // The proxy's handler answers its own challenge; one event is answered by one handler only.
    if (event.defaultPrevented) return
    const key = `${URL.canParse(details.url) ? new URL(details.url).origin : "null"}\n${auth.scheme.toLowerCase()}\n${auth.realm}`

    const answer = challengeAnswer(
      { url: details.url, isProxy: auth.isProxy, scheme: auth.scheme, realm: auth.realm, first: details.firstAuthAttempt },
      { top: committedOrigin, pending, attempts: attempts.get(key) ?? 0 },
    )

    if (answer.type !== "prompt") {
      if (answer.type === "cancel") attempts.delete(key)

      return
    }

    event.preventDefault()
    attempts.set(answer.key, answer.attempt)
    const once = onceCallback(callback)

    const id = enqueue({
      kind: "auth",
      key: answer.key,
      host: promptHost(details.url),
      realm: promptText(auth.realm, 256),
      failed: answer.attempt > 1,
    })

    authCallbacks.set(id, [...(authCallbacks.get(id) ?? []), once])
    agentWaits.forEach((stop) =>
      stop(
        new CodedError(
          Browser.FailureCode.signInRequired,
          `${new URL(details.url).host} asks for a user name and password. The browser pane asks the user to sign in; agent tools cannot answer it. Ask the user to sign in in the browser pane, then continue with browser.tabs.list({}).`,
        ),
      ),
    )
  }

  // A page that asks to confirm before it unloads: a navigation or close the user started waits for "Leave site?";
  // the agent's and the page's own keep Electron's answer, which keeps the page. Synchronous: Chromium waits on it.
  const unload = (event: Electron.Event) => {
    if (bypass) {
      bypass = false
      event.preventDefault()

      return
    }

    const action = intent && Date.now() - intent.at <= INTENT_MS ? intent.action : undefined
    intent = undefined

    if (!action) return
    const id = enqueue({ kind: "leave", key: "leave" })
    leaveActions.set(id, action)
  }

  const started = (event: Electron.Event<{ url: string; isMainFrame: boolean; isSameDocument: boolean }>) => {
    if (!event.isMainFrame || event.isSameDocument) return
    pending = event.url
    intent = undefined
    // A new top-level navigation replaces the one that asked for a sign-in or held the page.
    dispatch({ type: "cleared", kinds: ["auth", "leave"] })
    publish()
  }

  const committed = () => {
    pending = undefined
    const origin = contents.mainFrame.origin

    // The visit ends when the tab leaves the origin; requests of the page that went end with it.
    if (origin !== committedOrigin) {
      visit.clear()
      attempts.clear()
    }

    committedOrigin = origin
    dispatch({ type: "cleared", kinds: ["permission", "leave", "system"] })
    publish()
  }

  const intend = (action: LeaveAction) => {
    const current = { action, at: Date.now() }
    intent = current

    return () => {
      if (intent === current) intent = undefined
    }
  }

  contents.on("login", login)
  contents.on("will-prevent-unload", unload)
  contents.on("did-start-navigation", started)
  contents.on("did-navigate", committed)

  const permissions: PagePermissions = {
    request(permission, details, callback) {
      const once = onceCallback(callback)
      const origin = requestOrigin(details, contents)
      const request = { origin, top: contents.mainFrame.origin, mainFrame: details.isMainFrame }

      if (permission === "clipboard-sanitized-write") return once(clipboardWrite(request, input.agentCaused()))
      const kinds = permissionKinds(permission, details.mediaTypes)
      const answer = siteAnswer({ ...request, kinds }, decided(origin))

      if (answer === "block" || disposed) return once(false)

      if (answer === "allow") return grant(kinds, once)

      const id = enqueue({
        kind: "permission",
        key: `${origin}\n${kinds.join(",")}`,
        origin,
        permissions: kinds,
        remember: keptApplies(origin, input.remote),
      })

      permissionCallbacks.set(id, [...(permissionCallbacks.get(id) ?? []), (granted) => (granted ? grant(kinds, once) : once(false))])

      // A script the agent caused waits for this; it gets "no" in time rather than at its own timeout.
      if (input.agentCaused() && !deadlines.has(id))
        deadlines.set(
          id,
          setTimeout(() => {
            const callbacks = permissionCallbacks.get(id)
            permissionCallbacks.delete(id)
            settle(id)
            callbacks?.forEach((callback) => callback(false))
          }, AGENT_PROMPT_WAIT_MS),
        )
    },
    check(permission, requesting, details) {
      // Electron passes Chromium's origin of the asking frame as a URL with a trailing slash; the frame at the asking
      // address must agree with it, as for a request.
      const origin =
        details.requestingUrl === undefined || requestOrigin(details, contents) === originOf(requesting)
          ? originOf(requesting)
          : "null"
      const request = { origin, top: contents.mainFrame.origin, mainFrame: details.isMainFrame }

      if (permission === "clipboard-sanitized-write") return clipboardWrite(request, input.agentCaused())
      const kinds = permissionKinds(permission, details.mediaType ? [details.mediaType] : [])

      return siteAnswer({ ...request, kinds }, decided(origin)) === "allow"
    },
  }

  return {
    permissions,
    /** Reports the prompt again, after the dialog gate opened or closed a dialog. */
    publish,
    /** Marks a navigation as the user's while it starts, so a page that holds it asks "Leave site?". */
    intend,
    /**
     * Whether the user's close may go ahead now. A page that asks to confirm keeps the tab and asks "Leave site?",
     * whose Leave closes it. The page's unload handlers run on a blank document load; a handler that hangs is given up
     * on after a few seconds.
     */
    async leave() {
      if (disposed || contents.isDestroyed()) return true
      const before = state.next
      const clear = intend({ type: "close" })
      const timer = Promise.withResolvers<void>()
      const timeout = setTimeout(timer.resolve, LEAVE_PROBE_MS)
      await Promise.race([contents.loadURL("about:blank").catch(() => undefined), timer.promise])
      clearTimeout(timeout)
      clear()

      return !state.items.some((item) => item.kind === "leave" && item.id >= before)
    },
    /** Stops an agent command when a sign-in prompt appears while it runs. */
    agentWait() {
      const stopped = Promise.withResolvers<never>()
      agentWaits.add(stopped.reject)

      return { promise: stopped.promise, stop: () => agentWaits.delete(stopped.reject) }
    },
    async answer(id: number, answer: PromptAnswer) {
      if (answer.kind === "dialog") {
        if (input.dialog()?.revision !== id) return
        await input.answerDialog(id, answer)

        return input.focusPage()
      }

      const item = selectPrompted(state, id)

      if (!item) return
      const permission = item.kind === "permission" ? permissionCallbacks.get(id) : undefined
      const sign = item.kind === "auth" ? authCallbacks.get(id) : undefined
      const leave = leaveActions.get(id)
      permissionCallbacks.delete(id)
      authCallbacks.delete(id)
      leaveActions.delete(id)
      settle(id)

      if (item.kind === "permission") {
        const allow = answer.kind === "permission" && answer.allow

        if (answer.kind === "permission")
          // A kept decision lives in the store alone, so changing it in Settings applies to open tabs at once.
          item.permissions.forEach((kind) =>
            answer.remember && item.remember
              ? input.sites.keep({ origin: item.origin, permission: kind, setting: allow ? "allow" : "block" })
              : visit.set(`${item.origin}\n${kind}`, allow ? "allow" : "block"),
          )
        permission?.forEach((callback) => callback(allow))

        return
      }

      if (item.kind === "auth") {
        // The credentials go to Chromium alone; nothing here keeps them.
        sign?.forEach((callback) => (answer.kind === "auth" ? callback(answer.username, answer.password) : callback()))

        return input.focusPage()
      }

      if (item.kind === "leave" && answer.kind === "leave" && answer.leave && leave) {
        if (leave.type === "close") return input.close()
        bypass = true
        await input.redo(leave).finally(() => {
          bypass = false
        })

        return
      }

      if (item.kind === "leave") input.focusPage()
    },
    dispose() {
      if (disposed) return
      dispatch({ type: "cleared" })
      disposed = true
      visit.clear()
      agentWaits.clear()

      if (contents.isDestroyed()) return
      contents.off("login", login)
      contents.off("will-prevent-unload", unload)
      contents.off("did-start-navigation", started)
      contents.off("did-navigate", committed)
    },
  }
}

export type PagePrompts = ReturnType<typeof createPagePrompts>

/**
 * Takes the page's JavaScript dialogs from Electron, whose own handler draws a native message box for `alert` and
 * `confirm` and answers `prompt` with null at once. The pane shows them instead and answers them through CDP, as the
 * agent's browser.dialog does; Chromium runs the first answer and ignores the rest. This holds Chromium's callback
 * only to unblock the page when it closes, when Chromium cancels the page's dialogs, or when no CDP dialog follows,
 * and answers at once a dialog of a document whose dialogs the user stopped.
 */
export function takeDialogs(contents: WebContents, suppressed: () => boolean, opened: () => boolean) {
  // SAFETY: `-run-dialog` and `-cancel-dialogs` are Electron's own events on every WebContents (lib/browser/api/
  // web-contents.ts); its listener is the native message box this replaces. The listener's arguments are Electron's.
  const events: NodeJS.EventEmitter = contents
  const held = new Set<(success: boolean, text: string) => void>()

  const release = () => {
    held.forEach((callback) => callback(false, ""))
    held.clear()
  }

  const run = (_info: RunDialogInfo, callback: (success: boolean, text: string) => void) => {
    if (suppressed()) return callback(false, "")
    held.add(callback)
    // The page must never wait on a dialog nobody can see: one CDP never reported is dismissed.
    setTimeout(() => {
      if (held.has(callback) && !opened()) {
        held.delete(callback)
        callback(false, "")
      }
    }, 2_000)
  }

  events.removeAllListeners("-run-dialog")
  events.on("-run-dialog", run)
  events.on("-cancel-dialogs", release)

  return {
    /** Chromium closed the page's dialog; whoever answered, its callback already ran. */
    closed: () => held.clear(),
    dispose: () => {
      release()

      if (contents.isDestroyed()) return
      events.off("-run-dialog", run)
      events.off("-cancel-dialogs", release)
    },
  }
}

/**
 * Gives a top-level document Chromium's own `prompt` back. Electron replaces it in every main frame with one that
 * throws ("prompt() is not supported"); a frame Electron does not set up keeps the original, and calling it for this
 * window opens this window's dialog, which the pane shows like `alert` and `confirm`.
 */
export const RESTORE_PROMPT = `(() => {
  if (window !== window.top) return
  let native
  const prompt = function prompt(message, value) {
    if (!native) {
      const frame = document.createElement("iframe")
      frame.hidden = true
      ;(document.body ?? document.documentElement).append(frame)
      native = frame.contentWindow.prompt
      frame.remove()
    }
    return Reflect.apply(native, window, arguments)
  }
  Object.defineProperty(window, "prompt", { value: prompt, writable: true, configurable: true, enumerable: true })
})()`

function device(kind: "camera" | "microphone") {
  if (process.platform !== "darwin" && process.platform !== "win32") return true
  const status = systemPreferences.getMediaAccessStatus(kind)

  // macOS asks once for the microphone; this app declares no camera use, so macOS would end it for asking.
  if (process.platform === "darwin" && status === "not-determined") return false

  return status !== "denied" && status !== "restricted"
}

/** The asking frame's own origin (equesterOrigin); a media request's security origin must agree with it. */
function requestOrigin(details: Details, contents: WebContents) {
  const main = contents.mainFrame

  const origin = requesterOrigin({
    mainFrame: details.isMainFrame,
    requestingUrl: details.requestingUrl,
    main: { url: main.url, origin: main.origin },
    frames: main.framesInSubtree.map((frame) => ({ url: frame.url, origin: frame.origin })),
  })

  return details.securityOrigin === undefined || originOf(details.securityOrigin) === origin ? origin : "null"
}

function onceCallback<Args extends unknown[]>(callback: (...args: Args) => void) {
  const state = { called: false }

  return (...args: Args) => {
    if (state.called) return
    state.called = true
    callback(...args)
  }
}
