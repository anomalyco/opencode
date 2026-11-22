import type { WebContents } from "electron"
import { Browser } from "@opencode/plugin-browser/rpc"
import { CodedError } from "./errors"
import type { DialogInfo } from "./dialog-machine"
import { displayHost } from "./host-display"
import { PROMPT_TEXT_MAX, type PromptAnswer, type PromptView } from "./ipc"
import {
  createVisit,
  initialPrompts,
  promptSite,
  promptText,
  selectPrompt,
  selectPrompted,
  transitionPrompts,
  transitionVisit,
  type LeaveAction,
  type Asked,
  type PromptEvent,
  type VisitEvent,
  type Waiting,
  type WaitingRequest,
} from "./prompt-machine"
import type { MediaAsk } from "./media-gate"
import { challengeAnswer, challengeKey } from "./site-auth"
import {
  clipboardWrite,
  originOf,
  decisionLife,
  permissionKinds,
  requesterOrigin,
  siteAnswer,
  type DecisionScope,
  type PermissionKind,
  type SitePermissions,
} from "./site-permissions"
import { deviceStep, requestAccess, type MediaDevice, type SystemMedia } from "./system-media"

/** How long a request that arrives while an agent command runs in the tab waits for the user before the page is told no. */
export const AGENT_PROMPT_WAIT_MS = 20_000

/** How long a device request the pane let through stays allowed for the page's own request that follows it. */
const RELEASE_MS = 30_000

/** How long closing a tab waits for the page's beforeunload before it closes anyway. */
const LEAVE_PROBE_MS = 3_000

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
type RunDialogInfo = { readonly frame?: Electron.WebFrameMain | null; readonly dialogType?: string }

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
  /** Where the tab's decisions are made and apply: the local profile or one remote server's partition. */
  readonly scope: DecisionScope
  readonly sites: SitePermissions
  /** The agent drives the tab: it ran a command in it, or the tab that opened it did (policy.ts `agentDriven`, sticky). */
  readonly agentDriven: () => boolean
  /** The tab's top-level address as the pane shows it, so a preview reads as its file. */
  readonly top: () => string
  readonly dialog: () => OpenDialog | null
  /** The live frame of the open dialog, once Electron reported it; its origin names the dialog. */
  readonly dialogFrame: () => { readonly origin: string; readonly main: boolean } | undefined
  readonly answerDialog: (revision: number, answer: Extract<PromptAnswer, { kind: "dialog" }>) => Promise<void>
  /** Runs a user navigation again after the user chose to leave. */
  readonly redo: (action: Browser.Action) => Promise<void>
  /** Closes the tab after the user chose to leave it. */
  readonly close: () => void
  /** Gives the page keyboard focus back when its tab is in front, once its view shows again. */
  readonly focusPage: () => void
  /** The tab is the one in front and the app window has the keyboard: a dialog may take it (never from another app). */
  readonly front: () => boolean
  /** The page is owed the keyboard and gets it once its view shows again (see `focusPage`). */
  readonly returning: () => boolean
  /** Keeps the tab's state as it was while a close loads a blank page to ask the page's beforeunload. */
  readonly quiet: (quiet: boolean) => void
  readonly report: (view: PromptView | null) => void
  /** The system's camera and microphone setting, and its prompt (system-media.ts). */
  readonly system: SystemMedia
}) {
  const contents = input.contents
  let state = initialPrompts
  // The tab's visit: its navigation in flight, the user's last navigation, its sign-ins (see `transitionVisit`).
  let visit = createVisit(contents.mainFrame.origin)
  // The callbacks each waiting item answers, by its id; a joined request adds its own.
  const permissionCallbacks = new Map<number, ((granted: boolean) => void)[]>()
  const authCallbacks = new Map<number, ((username?: string, password?: string) => void)[]>()
  const leaveActions = new Map<number, LeaveAction>()
  const deadlines = new Map<number, ReturnType<typeof setTimeout>>()
  // This visit's decisions, by origin and feature, until the tab leaves the origin or closes.
  const decisions = new Map<string, "allow" | "block">()
  // Device requests the pane let through after the user's Allow, by origin and features, until their deadline.
  const released = new Map<string, number>()
  // Agent commands running now, which a sign-in the user must answer stops with a clear error.
  const agentWaits = new Set<(error: Error) => void>()
  let reported = "null"
  // The page held the keyboard when the prompts began to show, so it gets it back once they end (owed while one still
  // shows). A prompt that shows while an answer is in flight, as a page's next dialog does, continues the same chain.
  let pageHeld = false
  let owed = false
  let answering = 0
  let disposed = false

  // The decisions in the tab's scope (see siteAnswer): a kept "block" wins over this visit's answer, so blocking a site
  // in Settings applies to its open tabs at once.
  const decided = (origin: string) => ({
    kept: (kind: PermissionKind) => input.sites.get(input.scope, origin, kind),
    visit: (kind: PermissionKind) => decisions.get(`${origin}\n${kind}`),
  })

  const dispatch = (event: PromptEvent) => {
    const next = transitionPrompts(state, event)
    state = next.state
    next.ended.forEach((id) => end(id))

    return next
  }

  const dispatchVisit = (event: VisitEvent) => {
    const next = transitionVisit(visit, event)
    visit = next.state

    if (next.ended) decisions.clear()

    if (next.clear) {
      dispatch({ type: "cleared", ...next.clear })
      publish()
    }

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

  // The keyboard goes back to the page only if the page had it; the window gives it back wherever else it was.
  const refocus = () => {
    if (!pageHeld) return

    if (view()) return void (owed = true)
    input.focusPage()
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
    const key = JSON.stringify(next && { ...next, focus: false, page: false })

    if (key === reported) return

    if (reported === "null" && next) pageHeld = next.page || (pageHeld && (answering > 0 || input.returning()))
    reported = key
    input.report(next)

    if (next || !(owed || input.returning())) return
    owed = false
    input.focusPage()
  }

  const view = (): PromptView | null => {
    const dialog = input.dialog()
    const head = selectPrompt(state)
    const waiting = state.items.length + (dialog ? 1 : 0) - 1
    const page = !contents.isDestroyed() && contents.isFocused()
    const agent = input.agentDriven()
    // A dialog blocks the tab in front, so it takes the keyboard there, unless the agent drives the tab and the user is
    // elsewhere; a bar takes it only from its page. Neither takes it from another app or another tab.
    const modal = input.front() && (page || !agent)
    const bar = page && !agent

    // "Leave site?" goes first: a close the page held keeps its tab only while the pane shows it.
    if (head && (head.kind === "leave" || !dialog)) {
      const focus = head.kind === "leave" || head.kind === "auth" ? modal : bar

      return { id: head.id, asked: head.asked, waiting, focus, page, ask: ask(head) }
    }

    if (!dialog) return null

    return {
      id: dialog.revision,
      asked: 1,
      waiting,
      focus: modal,
      page,
      ask: {
        kind: "dialog",
        dialog: dialog.dialog.type === "confirm" || dialog.dialog.type === "prompt" ? dialog.dialog.type : "alert",
        site: promptSite(dialog.url, input.top(), input.dialogFrame()),
        message: promptText(dialog.dialog.message, PROMPT_TEXT_MAX),
        value: promptText(dialog.dialog.defaultValue, PROMPT_TEXT_MAX),
        stop: !!dialog.repeat,
      },
    }
  }

  const ask = (item: Waiting): PromptView["ask"] => {
    if (item.kind === "permission")
      return {
        kind: "permission",
        site: promptSite(item.origin, item.origin),
        permissions: item.permissions,
        remember: item.remember,
        agent: item.agent,
        system: item.system,
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

  // The system's access for the camera and microphone a request names (system-media.ts); other features need none.
  const devices = (kinds: readonly PermissionKind[]) =>
    kinds.filter((kind): kind is MediaDevice => kind === "camera" || kind === "microphone")

  const systemAccess = (kinds: readonly PermissionKind[]) =>
    requestAccess(devices(kinds).map((device) => input.system.access(device)))

  // A device the system refuses: the page is told no with the notice that names the system's setting.
  const refuse = (kinds: readonly PermissionKind[], callback: (granted: boolean) => void) => {
    const device = devices(kinds).find((kind) => input.system.access(kind) === "denied")
    callback(false)

    if (device) enqueue({ kind: "system", key: `system\n${device}`, device })
  }

  // After the user allowed a request in the bar: the system grants it, refuses it, or macOS asks now, once per device.
  // A held call (`gated`, media-gate.ts) is let through, and the page's own request for it follows without a bar.
  const allowed = (origin: string, kinds: readonly PermissionKind[], callback: (granted: boolean) => void, gated: boolean) => {
    const step = deviceStep({ system: systemAccess(kinds), allowed: true })

    if (step === "refuse") return refuse(kinds, callback)

    if (step === "grant") {
      if (gated) released.set(`${origin}\n${kinds.join(",")}`, Date.now() + RELEASE_MS)

      return callback(true)
    }

    const device = devices(kinds).find((kind) => input.system.access(kind) === "ask")

    if (!device) return callback(false)
    void input.system.ask(device, origin).then(
      () => {
        // The page may have gone or moved on while macOS asked.
        if (disposed || contents.isDestroyed() || originOf(contents.mainFrame.origin) !== originOf(origin)) return callback(false)
        allowed(origin, kinds, callback, gated)
      },
      () => callback(false),
    )
  }

  // Shows the request in the bar; the callback gets the user's answer, a deadline's or a navigation's.
  const prompt = (
    origin: string,
    kinds: readonly PermissionKind[],
    agent: boolean,
    callback: (granted: boolean) => void,
    gated: boolean,
  ) => {
    const id = enqueue({
      kind: "permission",
      // The agent's request never joins the user's, whose answer may be kept.
      key: `${origin}\n${kinds.join(",")}${agent ? "\nagent" : ""}`,
      origin,
      permissions: kinds,
      remember: agent ? "none" : ({ kept: "kept", session: "session", visit: "none" } as const)[decisionLife(input.scope, origin)],
      agent,
      system: systemAccess(kinds) === "ask",
    })

    permissionCallbacks.set(id, [
      ...(permissionCallbacks.get(id) ?? []),
      (granted) => (granted ? allowed(origin, kinds, callback, gated) : callback(false)),
    ])

    // A script the agent runs waits for this; it gets "no" in time rather than at its own timeout.
    if (agent && !deadlines.has(id))
      deadlines.set(
        id,
        setTimeout(() => {
          const callbacks = permissionCallbacks.get(id)
          permissionCallbacks.delete(id)
          settle(id)
          callbacks?.forEach((answer) => answer(false))
        }, AGENT_PROMPT_WAIT_MS),
      )
  }

  // What a request gets: the site's answer for other features, and for a device also the system's access (`deviceStep`).
  // A device request the pane let through (`released`) is the one the user just allowed.
  const decide = (
    request: { readonly origin: string; readonly top: string; readonly mainFrame: boolean },
    kinds: readonly PermissionKind[],
    callback: (granted: boolean) => void,
    gated: boolean,
  ) => {
    const agent = input.agentDriven()
    const answer = siteAnswer({ ...request, kinds, agentDriven: agent }, decided(request.origin))

    if (answer === "block" || disposed) return callback(false)

    if (!devices(kinds).length) return answer === "allow" ? callback(true) : prompt(request.origin, kinds, agent, callback, gated)
    const key = `${request.origin}\n${kinds.join(",")}`
    const release = !gated && (released.get(key) ?? 0) > Date.now()
    released.delete(key)
    const step = deviceStep({ system: systemAccess(kinds), decision: answer === "allow" ? "allow" : undefined, allowed: release })

    if (step === "refuse") return refuse(kinds, callback)

    if (step === "deny") return callback(false)

    if (step === "grant") return callback(true)

    if (step === "ask-system") return allowed(request.origin, kinds, callback, gated)

    prompt(request.origin, kinds, agent, callback, gated)
  }

  const signInRequired = (host: string) =>
    new CodedError(
      Browser.FailureCode.signInRequired,
      `${host} asks for a user name and password. The browser pane asks the user to sign in; agent tools cannot answer it. Ask the user to sign in in the browser pane, then continue with browser.tabs.list({}).`,
    )

  const login = (
    event: Electron.Event,
    details: Electron.AuthenticationResponseDetails,
    auth: Electron.AuthInfo,
    callback: (username?: string, password?: string) => void,
  ) => {
    // The proxy's handler answers its own challenge; one event is answered by one handler only.
    if (event.defaultPrevented) return
    const origin = originOf(details.url)
    const key = challengeKey(origin, auth.scheme)

    const answer = challengeAnswer(
      { url: details.url, isProxy: auth.isProxy, scheme: auth.scheme, realm: auth.realm, first: details.firstAuthAttempt },
      { top: visit.committed, pending: visit.pending, attempts: visit.attempts[key] ?? 0, dismissed: visit.dismissed.includes(origin) },
    )

    if (answer.type !== "prompt") return
    event.preventDefault()
    dispatchVisit({ type: "challenged", key: answer.key, attempt: answer.attempt })
    const once = onceCallback(callback)

    const id = enqueue({
      kind: "auth",
      key: answer.key,
      origin,
      host: displayHost(details.url),
      realm: promptText(auth.realm, 256),
      failed: !details.firstAuthAttempt,
      navigation: details.isRequestForNavigation && visit.pending !== undefined && originOf(visit.pending) === origin,
    })

    authCallbacks.set(id, [...(authCallbacks.get(id) ?? []), once])
    agentWaits.forEach((stop) => stop(signInRequired(new URL(details.url).host)))
  }

  // A page that asks to confirm before it unloads: a navigation or close the user started waits for "Leave site?";
  // the agent's and the page's own keep Electron's answer, which keeps the page. Synchronous: Chromium waits on it.
  const unload = (event: Electron.Event) => {
    const next = dispatchVisit({ type: "unloading", at: Date.now() })

    if (next.proceed) return event.preventDefault()

    if (!next.leave) return
    const id = enqueue({ kind: "leave", key: "leave" })
    leaveActions.set(id, next.leave)
  }

  type Navigation = Electron.Event<{ url: string; isMainFrame: boolean; isSameDocument: boolean }>

  const started = (event: Navigation) => {
    if (event.isMainFrame && !event.isSameDocument) dispatchVisit({ type: "started", url: event.url })
  }

  const redirected = (event: Navigation) => {
    if (event.isMainFrame) dispatchVisit({ type: "redirected", url: event.url })
  }

  const committed = () => dispatchVisit({ type: "committed", origin: contents.mainFrame.origin })
  const stopped = () => dispatchVisit({ type: "stopped" })

  const intend = (action: LeaveAction) => dispatchVisit({ type: "intended", action, at: Date.now() })

  contents.on("login", login)
  contents.on("will-prevent-unload", unload)
  contents.on("did-start-navigation", started)
  contents.on("did-redirect-navigation", redirected)
  contents.on("did-navigate", committed)
  contents.on("did-stop-loading", stopped)

  const permissions: PagePermissions = {
    request(permission, details, callback) {
      const once = onceCallback(callback)
      const origin = requestOrigin(details, contents)
      const request = { origin, top: contents.mainFrame.origin, mainFrame: details.isMainFrame }

      if (permission === "clipboard-sanitized-write") return once(clipboardWrite(request, input.agentDriven()))
      decide(request, permissionKinds(permission, details.mediaTypes), once, false)
    },
    check(permission, requesting, details) {
      // Electron passes Chromium's origin of the asking frame as a URL with a trailing slash; the frame at the asking
      // address must agree with it, as for a request.
      const origin =
        details.requestingUrl === undefined || requestOrigin(details, contents) === originOf(requesting)
          ? originOf(requesting)
          : "null"

      const request = { origin, top: contents.mainFrame.origin, mainFrame: details.isMainFrame }

      const agent = input.agentDriven()

      if (permission === "clipboard-sanitized-write") return clipboardWrite(request, agent)
      const kinds = permissionKinds(permission, details.mediaType ? [details.mediaType] : [])
      const answer = siteAnswer({ ...request, kinds, agentDriven: agent }, decided(origin))

      if (answer !== "allow" || !devices(kinds).length) return answer === "allow"

      // A device reads as allowed only once the system grants it, so nothing probes it before the user's Allow.
      return deviceStep({ system: systemAccess(kinds), decision: "allow", allowed: false }) === "grant"
    },
  }

  const respond = async (id: number, answer: PromptAnswer) => {
    if (answer.kind === "dialog") {
      if (input.dialog()?.revision !== id) return
      await input.answerDialog(id, answer)

      return refocus()
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

    if (item.kind === "permission" || item.kind === "system") {
      const allow = answer.kind === "permission" && answer.allow

      // A kept decision lives in the store alone, so changing it in Settings applies to open tabs at once. An allow
      // given while the agent drives the tab is for that request alone.
      if (item.kind === "permission" && answer.kind === "permission" && !(item.agent && allow))
        item.permissions.forEach((kind) =>
          answer.remember && item.remember !== "none"
            ? input.sites.keep(input.scope, { origin: item.origin, permission: kind, setting: allow ? "allow" : "block" })
            : decisions.set(`${item.origin}\n${kind}`, allow ? "allow" : "block"),
        )
      permission?.forEach((callback) => callback(allow))

      return refocus()
    }

    if (item.kind === "auth") {
      if (answer.kind !== "auth") dispatchVisit({ type: "dismissed", origin: item.origin })
      // The credentials go to Chromium alone; nothing here keeps them.
      sign?.forEach((callback) => (answer.kind === "auth" ? callback(answer.username, answer.password) : callback()))

      return refocus()
    }

    if (answer.kind === "leave" && answer.leave && leave) {
      if (leave.type === "close") return input.close()
      dispatchVisit({ type: "bypassed" })
      await input.redo(leave).finally(() => dispatchVisit({ type: "bypass-ended" }))

      return
    }

    refocus()
  }

  return {
    permissions,
    /**
     * Decides a page's getUserMedia before Blink opens any device (media-gate.ts): let through at once unless macOS has
     * not asked yet, else after the user's Allow and the system's answer.
     */
    gate(ask: MediaAsk) {
      if (systemAccess(ask.kinds) === "granted") return Promise.resolve(true)
      const answer = Promise.withResolvers<boolean>()
      decide({ origin: ask.origin, top: contents.mainFrame.origin, mainFrame: ask.mainFrame }, ask.kinds, onceCallback(answer.resolve), true)

      return answer.promise
    },
    /** Something shows: the page's view stays hidden behind it, and gets the keyboard back only once it ends. */
    showing: () => reported !== "null",
    /** Reports the prompt again, after the dialog gate opened or closed a dialog. */
    publish,
    /** Marks a navigation as the user's while it starts, so a page that holds it asks "Leave site?". */
    intend,
    /** An agent command started: a page that unloads now does not ask the user. */
    agentStarted: () => dispatchVisit({ type: "intent-ended" }),
    /** A "Leave site?" or sign-in covers the page with its still: the user sees no live page to aim at. */
    covered: () => state.items.some((item) => item.kind === "leave" || item.kind === "auth"),
    /**
     * Whether the user's close may go ahead now. A page that asks to confirm keeps the tab and asks "Leave site?",
     * whose Leave closes it. The page's unload handlers run on a blank document load, which the tab's state never
     * shows; a handler that hangs is given up on after a few seconds.
     */
    async leave() {
      if (disposed || contents.isDestroyed()) return true
      const before = state.next
      intend({ type: "close" })
      input.quiet(true)
      const timer = Promise.withResolvers<void>()
      const timeout = setTimeout(timer.resolve, LEAVE_PROBE_MS)
      await Promise.race([contents.loadURL("about:blank").catch(() => undefined), timer.promise])
      clearTimeout(timeout)
      dispatchVisit({ type: "intent-ended" })
      const held = state.items.some((item) => item.kind === "leave" && item.id >= before)

      // A page that stays keeps its state; one that goes closes with the state it had.
      if (held) input.quiet(false)

      return !held
    },
    /**
     * Stops an agent command when a sign-in prompt appears while it runs. A command other than a navigation stops at
     * once while one waits: the page behind it is the one the sign-in holds back.
     */
    agentWait(navigation: boolean) {
      const stopped = Promise.withResolvers<never>()
      const waiting = state.items.find((item): item is Extract<Asked, { kind: "auth" }> => item.kind === "auth")

      if (waiting && !navigation) stopped.reject(signInRequired(waiting.host))
      agentWaits.add(stopped.reject)

      return { promise: stopped.promise, stop: () => agentWaits.delete(stopped.reject) }
    },
    /** Stops the agent commands running now with `error`, for what the page did that only the user can resolve. */
    interruptAgent(error: Error) {
      agentWaits.forEach((stop) => stop(error))
    },
    /** The user's answer to what the tab shows; prompts that show while it runs continue the same focus chain. */
    async answer(id: number, answer: PromptAnswer) {
      answering++

      try {
        await respond(id, answer)
      } finally {
        answering--
      }
    },
    dispose() {
      if (disposed) return
      dispatch({ type: "cleared" })
      disposed = true
      decisions.clear()
      agentWaits.clear()

      if (contents.isDestroyed()) return
      contents.off("login", login)
      contents.off("will-prevent-unload", unload)
      contents.off("did-start-navigation", started)
      contents.off("did-redirect-navigation", redirected)
      contents.off("did-navigate", committed)
      contents.off("did-stop-loading", stopped)
    },
  }
}

export type PagePrompts = ReturnType<typeof createPagePrompts>

/**
 * Takes the page's JavaScript dialogs from Electron, whose own handler draws a native message box for `alert` and
 * `confirm` and answers `prompt` with null at once. The pane shows them instead and answers them through CDP, as the
 * agent's browser.dialog does; Chromium runs the first answer and ignores the rest. This holds Chromium's callback
 * only to unblock the page when it closes, when Chromium cancels the page's dialogs, or when no CDP dialog follows,
 * and answers at once a dialog of a document whose dialogs the user stopped. It also records the asking frame, whose
 * live origin names the dialog.
 *
 * Both events are Electron internals (lib/browser/api/web-contents.ts in 44.x: `-run-dialog` with `(info, callback)`).
 * When they are not what this expects, it fails safe and says so once through `warn`: a listener that is not there
 * means another Electron handles dialogs, and a call without a callback is left to CDP, which still shows and answers
 * the dialog in the pane. `electron-dialogs.test.ts` runs this in the pinned Electron.
 */
export function takeDialogs(
  contents: WebContents,
  input: {
    /** The user stopped this document's dialogs. */
    readonly suppressed: () => boolean
    /** CDP reported the dialog open. */
    readonly opened: () => boolean
    /** Electron reported the asking frame; CDP reports the dialog before it does. */
    readonly framed: () => void
    readonly warn: (message: string) => void
  },
) {
  // SAFETY: `-run-dialog` and `-cancel-dialogs` are Electron's own events on every WebContents; its `-run-dialog`
  // listener is the native message box this replaces. Each argument is checked before use below.
  const events: NodeJS.EventEmitter = contents
  const held = new Map<DialogCallback, { readonly origin: string; readonly main: boolean } | undefined>()

  if (events.listenerCount("-run-dialog") === 0)
    input.warn("Electron has no -run-dialog listener on a page; the pane's dialog takeover may not match this Electron.")

  const release = () => {
    held.forEach((_frame, callback) => callback(false, ""))
    held.clear()
  }

  const run = (info?: RunDialogInfo | DialogCallback, last?: RunDialogInfo | DialogCallback) => {
    const callback = [last, info].find(dialogCallback)

    if (!callback) return input.warn("Electron's -run-dialog passed no callback; the dialog is left to CDP.")

    if (input.suppressed()) return callback(false, "")
    const details = dialogCallback(info) ? undefined : info
    const frame = details?.frame && !details.frame.isDestroyed() ? details.frame : undefined
    held.set(callback, frame ? { origin: frame.origin, main: frame.parent === null } : undefined)
    input.framed()
    // The page must never wait on a dialog nobody can see: one CDP never reported is dismissed.
    setTimeout(() => {
      if (held.has(callback) && !input.opened()) {
        held.delete(callback)
        callback(false, "")
      }
    }, 2_000)
  }

  events.removeAllListeners("-run-dialog")
  events.on("-run-dialog", run)
  events.on("-cancel-dialogs", release)

  return {
    /** The frame of the dialog the page shows now, once Electron reported it. */
    frame: () => [...held.values()].at(-1),
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

type DialogCallback = (success: boolean, text: string) => void

function dialogCallback(value: RunDialogInfo | DialogCallback | undefined): value is DialogCallback {
  return value instanceof Function
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
      const root = document.body ?? document.documentElement
      // A document without a root cannot hold the frame; the page gets the cancel answer, as a dismissed prompt.
      if (!root) return null
      const frame = document.createElement("iframe")
      frame.hidden = true
      root.append(frame)
      native = frame.contentWindow.prompt
      frame.remove()
    }
    return Reflect.apply(native, window, arguments)
  }
  Object.defineProperty(window, "prompt", { value: prompt, writable: true, configurable: true, enumerable: true })
})()`

/** The asking frame's own origin (`requesterOrigin`); a media request's security origin must agree with it. */
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
