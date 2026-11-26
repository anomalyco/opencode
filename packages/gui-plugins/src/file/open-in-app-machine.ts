import type { OpenApp } from "./apps"

/** How long one app's installed check may run before it is dropped and retried on the next demand. */
export const OPEN_IN_APP_CHECK_TIMEOUT_MS = 10_000

/**
 * How long a launch may keep every "Open in" control busy. Some platforms only answer once the app exits, so a launch
 * that runs longer has most likely opened.
 */
export const OPEN_IN_APP_LAUNCH_TIMEOUT_MS = 10_000

/** One app's installed check; an app without one is unchecked. */
export type OpenAppCheck =
  | { readonly status: "checking"; readonly attempt: number }
  | { readonly status: "settled"; readonly installed: boolean }

/** The window's one "Open in" launch, which every control shares. */
export type OpenInAppLaunch =
  | { readonly status: "idle" }
  | { readonly status: "launching"; readonly attempt: number; readonly app: OpenApp }

export type OpenInAppState =
  | {
      readonly status: "active"
      /** The last attempt id handed out, across checks and launches. */
      readonly issued: number
      /** Checks by the name the desktop opens the app with. */
      readonly apps: Readonly<Record<string, OpenAppCheck>>
      readonly launch: OpenInAppLaunch
    }
  | { readonly status: "disposed" }

export type OpenInAppEvent =
  /** A control lists the OS's apps; checks the ones not checked or being checked. */
  | { readonly type: "apps.requested"; readonly openWith: readonly string[] }
  | { readonly type: "app.checked"; readonly attempt: number; readonly openWith: string; readonly installed: boolean }
  /** The check failed or timed out; dropped so a later demand checks again instead of hiding the app for good. */
  | { readonly type: "app.check-dropped"; readonly attempt: number; readonly openWith: string }
  | {
      readonly type: "launch.requested"
      readonly app: OpenApp
      readonly target: string
      readonly openWith?: string
      /** Reveal the target in the file manager rather than open it. */
      readonly reveal: boolean
    }
  | { readonly type: "launch.succeeded"; readonly attempt: number }
  | { readonly type: "launch.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "launch.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type OpenInAppEffect =
  | { readonly type: "check-app"; readonly attempt: number; readonly openWith: string; readonly timeoutMs: number }
  | {
      readonly type: "run-launch"
      readonly attempt: number
      readonly target: string
      readonly openWith?: string
      readonly reveal: boolean
      readonly timeoutMs: number
    }
  | { readonly type: "clear-timer"; readonly attempt: number }
  | { readonly type: "toast-failed"; readonly error: string }

export type OpenInAppTransition = {
  readonly state: OpenInAppState
  readonly effects: readonly OpenInAppEffect[]
}

type Active = Extract<OpenInAppState, { status: "active" }>

const NONE: readonly OpenInAppEffect[] = []

export function createOpenInAppState(): OpenInAppState {
  return { status: "active", issued: 0, apps: {}, launch: { status: "idle" } }
}

export function transitionOpenInApp(state: OpenInAppState, event: OpenInAppEvent): OpenInAppTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: [
        ...Object.values(state.apps).flatMap((check) =>
          check.status === "checking" ? [{ type: "clear-timer" as const, attempt: check.attempt }] : [],
        ),
        ...(state.launch.status === "launching"
          ? [{ type: "clear-timer" as const, attempt: state.launch.attempt }]
          : []),
      ],
    }

  if (event.type === "apps.requested") return requested(state, event.openWith)

  if (event.type === "app.checked" || event.type === "app.check-dropped") {
    const check = state.apps[event.openWith]

    if (check?.status !== "checking" || check.attempt !== event.attempt) return unchanged(state)

    return {
      state: {
        ...state,
        apps:
          event.type === "app.checked"
            ? { ...state.apps, [event.openWith]: { status: "settled", installed: event.installed } }
            : Object.fromEntries(Object.entries(state.apps).filter(([key]) => key !== event.openWith)),
      },
      effects: [{ type: "clear-timer", attempt: event.attempt }],
    }
  }

  if (event.type === "launch.requested") {
    // One launch at a time across the header, menus and file trees; an empty target opens nothing.
    if (!event.target || state.launch.status === "launching") return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, launch: { status: "launching", attempt, app: event.app } },
      effects: [
        {
          type: "run-launch",
          attempt,
          target: event.target,
          openWith: event.openWith,
          reveal: event.app === "finder" && event.reveal,
          timeoutMs: OPEN_IN_APP_LAUNCH_TIMEOUT_MS,
        },
      ],
    }
  }

  // A result after the timeout, such as a non-zero exit when the user later closes the app, reports nothing.
  if (state.launch.status !== "launching" || state.launch.attempt !== event.attempt) return unchanged(state)
  const clear: OpenInAppEffect = { type: "clear-timer", attempt: event.attempt }

  return {
    state: { ...state, launch: { status: "idle" } },
    effects: event.type === "launch.failed" ? [clear, { type: "toast-failed", error: event.error }] : [clear],
  }
}

/** Whether the app answered that it is installed. Unchecked, checking and dropped apps are not listed. */
export function isOpenAppInstalled(state: OpenInAppState, openWith: string) {
  if (state.status !== "active") return false
  const check = state.apps[openWith]

  return check?.status === "settled" && check.installed
}

/** Whether a launch is running; every "Open in" control is disabled while one is. */
export function isOpenInAppLaunching(state: OpenInAppState) {
  return state.status === "active" && state.launch.status === "launching"
}

function requested(state: Active, openWith: readonly string[]): OpenInAppTransition {
  const missing = [...new Set(openWith)].filter((key) => !state.apps[key])

  if (missing.length === 0) return unchanged(state)

  const checks = missing.map((key, index) => ({ key, attempt: state.issued + index + 1 }))

  return {
    state: {
      ...state,
      issued: state.issued + missing.length,
      apps: {
        ...state.apps,
        ...Object.fromEntries(
          checks.map((check): [string, OpenAppCheck] => [check.key, { status: "checking", attempt: check.attempt }]),
        ),
      },
    },
    effects: checks.map((check) => ({
      type: "check-app",
      attempt: check.attempt,
      openWith: check.key,
      timeoutMs: OPEN_IN_APP_CHECK_TIMEOUT_MS,
    })),
  }
}

function unchanged(state: OpenInAppState): OpenInAppTransition {
  return { state, effects: NONE }
}
