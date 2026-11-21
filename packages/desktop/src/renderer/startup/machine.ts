import type { LayoutRoute, Locale } from "@opencode/app/desktop"
import type { ServerReadyData } from "../../shared/ipc-contract"
import { localServerStartupError } from "./initialization"

/**
 * How long the window waits for the local server before it shows the error page. Main bounds its own start (two
 * 120 s attempts at most), so this only catches a renderer that never hears back, such as a lost IPC port.
 */
export const SIDECAR_TIMEOUT_MS = 300_000

/** How long the window waits, once the server is known, for the rest of startup before it shows the app anyway. */
export const HYDRATION_TIMEOUT_MS = 30_000

/** Fallback for the 300 ms opacity transition on `startup-overlay`. */
export const FADE_TIMEOUT_MS = 350

export type StartupTimer = "sidecar" | "hydration" | "fade"

export type LocaleGate = { readonly settled: false } | { readonly settled: true; readonly value: Locale | undefined }

/** Only the first-launch onboarding preview (`OPENCODE_TEST_ONBOARDING` on `/`) waits for the wordmark to draw. */
export type DrawingPhase = "not-needed" | "pending" | "running" | "done"

/**
 * The window's startup splash, from the first render to the revealed app. The app interface mounts once the server,
 * the first-launch decision, the locale and the plugin servers are known (`hydrating`); the splash fades out once the
 * route, onboarding and tabs are ready. Every waiting phase has a timer, so the splash cannot stay up forever.
 */
export type StartupState =
  | {
      readonly status: "booting"
      readonly initialUrl: string
      readonly preview: boolean
      readonly reducedMotion: boolean
      readonly route: LayoutRoute
      /** `undefined` until a fresh install has asked main whether onboarding is pending. */
      readonly firstLaunch: boolean | undefined
      readonly locale: LocaleGate
      readonly themeApplied: boolean
      readonly sidecar: ServerReadyData | undefined
      readonly pluginServersReady: boolean
      readonly routePreloaded: boolean
      readonly drawing: DrawingPhase
    }
  | {
      readonly status: "hydrating"
      readonly initialUrl: string
      readonly reducedMotion: boolean
      readonly route: LayoutRoute
      readonly firstLaunch: boolean
      readonly locale: LocaleGate
      readonly themeApplied: boolean
      readonly sidecar: ServerReadyData
      readonly routePreloaded: boolean
      readonly onboardingDone: boolean
      readonly tabsReady: boolean
      readonly drawing: DrawingPhase
    }
  | {
      readonly status: "fading"
      readonly initialUrl: string
      readonly route: LayoutRoute
      readonly firstLaunch: boolean
      readonly locale: LocaleGate
      readonly themeApplied: boolean
      readonly sidecar: ServerReadyData
    }
  | {
      readonly status: "revealed"
      readonly firstLaunch: boolean
      readonly locale: LocaleGate
      readonly themeApplied: boolean
      readonly sidecar: ServerReadyData
    }
  | {
      readonly status: "failed"
      /** `undefined` when the error boundary already caught the error itself. */
      readonly failure: { readonly error: unknown } | undefined
      readonly locale: LocaleGate
      readonly themeApplied: boolean
    }
  | { readonly status: "disposed" }

export type StartupEvent =
  | { readonly type: "theme.applied" }
  | { readonly type: "first-launch.settled"; readonly pending: boolean }
  | { readonly type: "locale.settled"; readonly locale: Locale | undefined }
  | { readonly type: "sidecar.ready"; readonly data: ServerReadyData }
  | { readonly type: "sidecar.changed"; readonly data: ServerReadyData }
  | { readonly type: "plugin-servers.ready" }
  | { readonly type: "route.preloaded" }
  | { readonly type: "route.changed"; readonly route: LayoutRoute }
  | { readonly type: "onboarding.settled" }
  | { readonly type: "tabs.ready" }
  | { readonly type: "drawing.started" }
  | { readonly type: "drawing.ended" }
  | { readonly type: "overlay.transition-ended" }
  | { readonly type: "sidecar.timed-out" }
  | { readonly type: "hydration.timed-out" }
  | { readonly type: "fade.timed-out" }
  | { readonly type: "startup.failed"; readonly error: unknown }
  | { readonly type: "boundary.tripped" }
  | { readonly type: "disposed" }

export type StartupEffect =
  | { readonly type: "check-first-launch" }
  | { readonly type: "preload-locale" }
  | { readonly type: "await-sidecar" }
  | { readonly type: "preload-route"; readonly url: string }
  | { readonly type: "notify-theme-ready" }
  | { readonly type: "start-timer"; readonly timer: StartupTimer; readonly timeoutMs: number }
  | { readonly type: "cancel-timer" }

export type StartupTransition = {
  readonly state: StartupState
  readonly effects: readonly StartupEffect[]
}

const DISPOSED: StartupState = Object.freeze({ status: "disposed" })

const UNSETTLED: LocaleGate = Object.freeze({ settled: false })

const TIMEOUTS: Record<StartupTimer, number> = {
  sidecar: SIDECAR_TIMEOUT_MS,
  hydration: HYDRATION_TIMEOUT_MS,
  fade: FADE_TIMEOUT_MS,
}

export function createStartupState(input: {
  readonly initialUrl: string
  readonly route: LayoutRoute
  /** Known from the window bootstrap, except on a fresh install. */
  readonly firstLaunch: boolean | undefined
  readonly preview: boolean
  readonly reducedMotion: boolean
}): StartupTransition {
  const state: StartupState = {
    status: "booting",
    initialUrl: input.initialUrl,
    preview: input.preview,
    reducedMotion: input.reducedMotion,
    route: input.route,
    firstLaunch: input.firstLaunch,
    locale: UNSETTLED,
    themeApplied: false,
    sidecar: undefined,
    pluginServersReady: false,
    routePreloaded: false,
    drawing: drawingPhase(input.preview, input.firstLaunch, input.initialUrl),
  }

  return {
    state,
    effects: [
      input.firstLaunch === undefined
        ? { type: "check-first-launch" }
        : { type: "preload-route", url: preloadTarget(input.initialUrl, input.firstLaunch) },
      { type: "preload-locale" },
      { type: "await-sidecar" },
      { type: "start-timer", timer: "sidecar", timeoutMs: SIDECAR_TIMEOUT_MS },
    ],
  }
}

export function transitionStartup(state: StartupState, event: StartupEvent): StartupTransition {
  const next = step(state, event)

  if (next.state === state) return next

  // The theme notification and the phase timer follow from the state itself, so every path keeps them in step.
  const timer = activeTimer(next.state)

  return {
    state: next.state,
    effects: [
      ...next.effects,
      ...(themeNotified(state) || !themeNotified(next.state) ? [] : [{ type: "notify-theme-ready" } as const]),
      ...(timer === activeTimer(state)
        ? []
        : [
            { type: "cancel-timer" } as const,
            ...(timer ? [{ type: "start-timer", timer, timeoutMs: TIMEOUTS[timer] } as const] : []),
          ]),
    ],
  }
}

function step(state: StartupState, event: StartupEvent): StartupTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return to(DISPOSED)

  if (event.type === "theme.applied")
    return state.themeApplied ? unchanged(state) : to({ ...state, themeApplied: true })

  if (event.type === "locale.settled") {
    if (state.locale.settled) return unchanged(state)
    const locale = { settled: true, value: event.locale } as const

    return state.status === "booting" ? mount({ ...state, locale }) : to({ ...state, locale })
  }

  if (state.status === "failed") return unchanged(state)

  if (event.type === "sidecar.changed") {
    if (state.sidecar?.url === event.data.url) return unchanged(state)

    return state.status === "booting" ? mount({ ...state, sidecar: event.data }) : to({ ...state, sidecar: event.data })
  }

  if (state.status === "revealed") return unchanged(state)

  if (event.type === "boundary.tripped") return fail(state, undefined)

  if (state.status === "fading") {
    if (event.type === "overlay.transition-ended" || event.type === "fade.timed-out")
      return to({
        status: "revealed",
        firstLaunch: state.firstLaunch,
        locale: state.locale,
        themeApplied: state.themeApplied,
        sidecar: state.sidecar,
      })

    if (event.type === "route.changed" && event.route !== state.route) return to({ ...state, route: event.route })

    return unchanged(state)
  }

  // Once the app shows, a late startup failure must not replace the working window with the error page.
  if (event.type === "startup.failed") return fail(state, { error: event.error })

  if (event.type === "drawing.started")
    return state.drawing === "pending" ? to({ ...state, drawing: "running" }) : unchanged(state)

  if (event.type === "drawing.ended") {
    if (state.drawing !== "running") return unchanged(state)

    return state.status === "booting" ? to({ ...state, drawing: "done" }) : reveal({ ...state, drawing: "done" })
  }

  if (event.type === "route.preloaded") {
    if (state.routePreloaded) return unchanged(state)

    return state.status === "booting"
      ? to({ ...state, routePreloaded: true })
      : reveal({ ...state, routePreloaded: true })
  }

  if (state.status === "booting") return boot(state, event)

  if (event.type === "route.changed")
    return event.route === state.route ? unchanged(state) : to({ ...state, route: event.route })

  if (event.type === "onboarding.settled")
    return state.onboardingDone ? unchanged(state) : reveal({ ...state, onboardingDone: true })

  if (event.type === "tabs.ready") return state.tabsReady ? unchanged(state) : reveal({ ...state, tabsReady: true })

  if (event.type === "hydration.timed-out") return beginReveal(state)

  return unchanged(state)
}

function boot(state: Extract<StartupState, { status: "booting" }>, event: StartupEvent): StartupTransition {
  if (event.type === "first-launch.settled") {
    if (state.firstLaunch !== undefined) return unchanged(state)

    const next = mount({
      ...state,
      firstLaunch: event.pending,
      drawing: drawingPhase(state.preview, event.pending, state.initialUrl),
    })

    return {
      state: next.state,
      effects: [{ type: "preload-route", url: preloadTarget(state.initialUrl, event.pending) }, ...next.effects],
    }
  }

  // A sidecar that moved before this window's own answer arrived is the newer one.
  if (event.type === "sidecar.ready") return state.sidecar ? unchanged(state) : mount({ ...state, sidecar: event.data })

  if (event.type === "plugin-servers.ready")
    return state.pluginServersReady ? unchanged(state) : mount({ ...state, pluginServersReady: true })

  if (event.type === "sidecar.timed-out" && !state.sidecar)
    return fail(state, {
      error: localServerStartupError(new Error("Timed out waiting for local server initialization")),
    })

  // The server is up, so show the app with whatever else is still loading rather than the splash.
  if (event.type === "hydration.timed-out" && state.sidecar)
    return beginReveal({ ...state, sidecar: state.sidecar, firstLaunch: state.firstLaunch ?? false })

  return unchanged(state)
}

function mount(state: Extract<StartupState, { status: "booting" }>): StartupTransition {
  if (!state.sidecar || state.firstLaunch === undefined || !state.locale.settled || !state.pluginServersReady)
    return to(state)

  return to({
    status: "hydrating",
    initialUrl: state.initialUrl,
    reducedMotion: state.reducedMotion,
    route: state.route,
    firstLaunch: state.firstLaunch,
    locale: state.locale,
    themeApplied: state.themeApplied,
    sidecar: state.sidecar,
    routePreloaded: state.routePreloaded,
    onboardingDone: !state.firstLaunch,
    tabsReady: false,
    drawing: state.drawing,
  })
}

function reveal(state: Extract<StartupState, { status: "hydrating" }>): StartupTransition {
  const drawn = state.drawing === "not-needed" || state.drawing === "done"

  if (!state.routePreloaded || !state.onboardingDone || !state.tabsReady || !drawn) return to(state)

  return beginReveal(state)
}

function beginReveal(state: {
  readonly initialUrl: string
  readonly reducedMotion: boolean
  readonly route: LayoutRoute
  readonly firstLaunch: boolean
  readonly locale: LocaleGate
  readonly themeApplied: boolean
  readonly sidecar: ServerReadyData
}): StartupTransition {
  // Under reduced motion the overlay has no transition to wait for.
  if (state.reducedMotion)
    return to({
      status: "revealed",
      firstLaunch: state.firstLaunch,
      locale: state.locale,
      themeApplied: state.themeApplied,
      sidecar: state.sidecar,
    })

  return to({
    status: "fading",
    initialUrl: state.initialUrl,
    route: state.route,
    firstLaunch: state.firstLaunch,
    locale: state.locale,
    themeApplied: state.themeApplied,
    sidecar: state.sidecar,
  })
}

function fail(
  state: { readonly locale: LocaleGate; readonly themeApplied: boolean },
  failure: { readonly error: unknown } | undefined,
): StartupTransition {
  return to({ status: "failed", failure, locale: state.locale, themeApplied: state.themeApplied })
}

function to(state: StartupState): StartupTransition {
  return { state, effects: [] }
}

function unchanged(state: StartupState): StartupTransition {
  return { state, effects: [] }
}

/** Main shows the window once the theme is applied and, before the app mounts, the splash is chosen. */
function themeNotified(state: StartupState) {
  if (state.status === "disposed" || !state.themeApplied) return false

  return state.status !== "booting" || state.firstLaunch !== undefined
}

function activeTimer(state: StartupState): StartupTimer | undefined {
  if (state.status === "booting") return state.sidecar ? "hydration" : "sidecar"

  if (state.status === "hydrating") return "hydration"

  if (state.status === "fading") return "fade"
}

function drawingPhase(preview: boolean, firstLaunch: boolean | undefined, initialUrl: string): DrawingPhase {
  return preview && firstLaunch === true && initialUrl === "/" ? "pending" : "not-needed"
}

function preloadTarget(initialUrl: string, firstLaunch: boolean) {
  return firstLaunch && initialUrl === "/" ? "/new-session" : initialUrl
}

/** The locale the language provider starts with; it never suspends or throws. */
export function selectStartupLocale(state: StartupState) {
  if (state.status === "disposed" || !state.locale.settled) return undefined

  return state.locale.value
}

/** The startup error to throw inside the app's error boundary. */
export function selectStartupFailure(state: StartupState) {
  return state.status === "failed" ? state.failure : undefined
}

/** The splash is fading out or gone, so the user can see and use the app. */
export function selectStartupRevealed(state: StartupState) {
  return state.status === "fading" || state.status === "revealed"
}

export function selectInterfaceMounted(state: StartupState) {
  return state.status === "hydrating" || state.status === "fading" || state.status === "revealed"
}

export function selectSidecar(state: StartupState) {
  return state.status === "failed" || state.status === "disposed" ? undefined : state.sidecar
}

/** Whether this window runs first-launch onboarding, read once when the app interface mounts. */
export function selectFirstLaunch(state: StartupState) {
  return (state.status === "hydrating" || state.status === "fading" || state.status === "revealed") && state.firstLaunch
}

export function selectOverlayMounted(state: StartupState) {
  if (state.status === "booting") return state.firstLaunch !== undefined

  return state.status === "hydrating" || state.status === "fading"
}

export function selectOverlayFading(state: StartupState) {
  return state.status === "fading"
}

export function selectFirstLaunchSplash(state: StartupState) {
  if (state.status !== "booting" && state.status !== "hydrating" && state.status !== "fading") return false

  return state.firstLaunch === true && state.initialUrl === "/"
}

export function selectSplashDeep(state: StartupState) {
  if (state.status !== "booting" && state.status !== "hydrating" && state.status !== "fading") return false

  return state.route.type === "draft"
}

/** The first-launch wordmark waits for a visible, focused window before it draws. */
export function selectDrawingPaused(state: StartupState) {
  return (state.status === "booting" || state.status === "hydrating") && state.drawing === "pending"
}
