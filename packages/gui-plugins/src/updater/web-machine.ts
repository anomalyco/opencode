/**
 * The web app's update lifecycle. The server's service worker precaches the app, so a new build installs in the
 * background and then waits until every window closes, which an installed app (PWA) rarely does. This machine finds
 * that build, offers it, and moves every window to it on request.
 */

/** Where a registration's newest worker is. */
export type WebWorker = "none" | "installing" | "waiting"

type Meta = {
  /** The last check attempt issued; a result for any other attempt is stale. */
  readonly issued: number
  /** When the last check started, in epoch milliseconds, to space out automatic checks. */
  readonly checkedAt: number | undefined
}

/**
 * - `unavailable`: no service worker serves this page (development, or an insecure origin), so a reload is current.
 * - `idle`: nothing newer is known.
 * - `checking`: asking the server for a newer build; `manual` when the user asked.
 * - `up-to-date`: the user's last check found nothing newer.
 * - `downloading`: a newer build is downloading.
 * - `ready`: a newer build is downloaded and waits for a reload.
 * - `applying`: the newer build was asked to take over; every window reloads once it does.
 * - `reloading`: this window is reloading into the newer build (or a reset).
 * - `error`: the user's last check or download failed.
 */
export type WebUpdateState =
  | { readonly status: "unavailable" }
  | (Meta & { readonly status: "idle" })
  | (Meta & { readonly status: "checking"; readonly attempt: number; readonly manual: boolean })
  | (Meta & { readonly status: "up-to-date" })
  | (Meta & { readonly status: "downloading"; readonly manual: boolean })
  | (Meta & { readonly status: "ready" })
  | (Meta & { readonly status: "applying" })
  | { readonly status: "reloading" }
  | (Meta & { readonly status: "error"; readonly message: string })

export type WebUpdateEvent =
  | { readonly type: "registered"; readonly worker: WebWorker }
  | { readonly type: "check.requested"; readonly manual: boolean; readonly at: number }
  | { readonly type: "check.settled"; readonly attempt: number; readonly worker: WebWorker }
  | { readonly type: "check.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "worker.installing" }
  | { readonly type: "worker.installed" }
  | { readonly type: "worker.redundant" }
  | { readonly type: "apply.requested" }
  | { readonly type: "apply.timeout" }
  | { readonly type: "reset.requested" }
  /** Another window dropped the saved app, including the files this window still loads. */
  | { readonly type: "reset.elsewhere" }
  | { readonly type: "controller.changed" }

export type WebUpdateEffect =
  /** Ask the server for a newer service worker. */
  | { readonly type: "update"; readonly attempt: number }
  /** Tell the waiting worker to take over now. */
  | { readonly type: "skip-waiting" }
  | { readonly type: "reload" }
  /** Unregister the worker, delete its caches, tell every other window to reload, then reload from the server. */
  | { readonly type: "reset" }
  /** A newer build is ready: offer the reload. */
  | { readonly type: "announce" }
  /** Answer the user's check: nothing newer, or it failed with `message`. */
  | { readonly type: "report"; readonly result: "up-to-date" }
  | { readonly type: "report"; readonly result: "failed"; readonly message: string }

export type WebUpdateTransition = { readonly state: WebUpdateState; readonly effects: readonly WebUpdateEffect[] }

/** Automatic checks (focus, network, timer) closer together than this ask once. A user's check always runs. */
export const AUTO_CHECK_SPACING_MS = 60_000

export const initialWebUpdate: WebUpdateState = { status: "unavailable" }

export function transitionWebUpdate(state: WebUpdateState, event: WebUpdateEvent): WebUpdateTransition {
  if (state.status === "reloading") return unchanged(state)

  // Another window applied the update or dropped the saved app, or this one applied it: the old build's files are
  // gone, so reload.
  if (event.type === "controller.changed" || event.type === "reset.elsewhere")
    return { state: { status: "reloading" }, effects: [{ type: "reload" }] }

  if (event.type === "reset.requested") return { state: { status: "reloading" }, effects: [{ type: "reset" }] }

  if (state.status === "unavailable") {
    if (event.type !== "registered") return unchanged(state)

    return found({ issued: 0, checkedAt: undefined }, event.worker, false)
  }

  const meta: Meta = { issued: state.issued, checkedAt: state.checkedAt }

  switch (event.type) {
    case "check.requested":
      return checkRequested(state, event)
    case "check.settled":
      if (state.status !== "checking" || event.attempt !== state.attempt) return unchanged(state)

      return found(meta, event.worker, state.manual)
    case "check.failed":
      if (state.status !== "checking" || event.attempt !== state.attempt) return unchanged(state)

      // An automatic check fails whenever the device is offline; only the user's own check says so.
      if (!state.manual) return unchanged({ ...meta, status: "idle" })

      return {
        state: { ...meta, status: "error", message: event.message },
        effects: [{ type: "report", result: "failed", message: event.message }],
      }
    case "worker.installing":
      if (state.status === "downloading" || state.status === "ready" || state.status === "applying")
        return unchanged(state)

      return unchanged({ ...meta, status: "downloading", manual: state.status === "checking" && state.manual })
    case "worker.installed":
      if (state.status === "ready" || state.status === "applying") return unchanged(state)

      return { state: { ...meta, status: "ready" }, effects: [{ type: "announce" }] }
    case "worker.redundant":
      // The download failed and the browser kept the current build.
      if (state.status !== "downloading") return unchanged(state)

      if (!state.manual) return unchanged({ ...meta, status: "idle" })

      return {
        state: { ...meta, status: "error", message: "" },
        effects: [{ type: "report", result: "failed", message: "" }],
      }
    case "apply.requested":
      if (state.status !== "ready") return unchanged(state)

      return { state: { ...meta, status: "applying" }, effects: [{ type: "skip-waiting" }] }
    case "apply.timeout":
      // The new worker took over without telling this window; a reload still lands on it.
      if (state.status !== "applying") return unchanged(state)

      return { state: { status: "reloading" }, effects: [{ type: "reload" }] }
    case "registered":
      return unchanged(state)
  }
}

/** The one action the settings row and the titlebar offer for a state. */
export function webUpdateAction(state: WebUpdateState) {
  switch (state.status) {
    case "checking":
      return { label: "action.checking" as const }
    case "downloading":
      return { label: "action.downloading" as const }
    case "ready":
      return { label: "action.reload" as const, run: "apply" as const }
    case "applying":
    case "reloading":
      return { label: "action.reloading" as const }
    case "unavailable":
      return { label: "action.checkNow" as const }
    default:
      return { label: "action.checkNow" as const, run: "check" as const }
  }
}

/** Whether the titlebar shows the update button: a newer build is ready, or the window is moving to it. */
export function webUpdatePending(state: WebUpdateState) {
  return state.status === "ready" || state.status === "applying" || state.status === "reloading"
}

function checkRequested(
  state: Exclude<WebUpdateState, { status: "unavailable" | "reloading" }>,
  event: Extract<WebUpdateEvent, { type: "check.requested" }>,
): WebUpdateTransition {
  if (state.status === "checking" || state.status === "downloading")
    return unchanged(event.manual && !state.manual ? { ...state, manual: true } : state)

  // The newer build is already here: offer it again.
  if (state.status === "ready") return event.manual ? unchanged(state, [{ type: "announce" }]) : unchanged(state)

  if (state.status === "applying") return unchanged(state)

  if (!event.manual && state.checkedAt !== undefined && event.at - state.checkedAt < AUTO_CHECK_SPACING_MS)
    return unchanged(state)

  const attempt = state.issued + 1

  return {
    state: { issued: attempt, checkedAt: event.at, status: "checking", attempt, manual: event.manual },
    effects: [{ type: "update", attempt }],
  }
}

function found(meta: Meta, worker: WebWorker, manual: boolean): WebUpdateTransition {
  if (worker === "waiting") return { state: { ...meta, status: "ready" }, effects: [{ type: "announce" }] }

  if (worker === "installing") return unchanged({ ...meta, status: "downloading", manual })

  if (!manual) return unchanged({ ...meta, status: "idle" })

  return { state: { ...meta, status: "up-to-date" }, effects: [{ type: "report", result: "up-to-date" }] }
}

function unchanged(state: WebUpdateState, effects: readonly WebUpdateEffect[] = []): WebUpdateTransition {
  return { state, effects }
}
