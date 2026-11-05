import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import type { UpdaterState } from "@opencode/plugin/gui/updater"

export type UpdateTarget =
  | { readonly mode: "restart"; readonly version: string }
  | { readonly mode: "external"; readonly version: string; readonly url: string }

export type Platform = {
  readonly checkForUpdate: Effect.Effect<UpdateTarget | undefined, unknown>
  readonly stageUpdate: (options: { readonly differential: boolean }) => Effect.Effect<unknown, unknown>
  /** Starts quitAndInstall; succeeds once the app begins quitting for the update. */
  readonly installAndRestart: Effect.Effect<void, unknown>
  readonly externalInstall?: (url: string) => Effect.Effect<void, unknown>
}

export type Dependencies = {
  readonly currentVersion: string
  readonly platform?: Platform
  /** Prepares the app to quit, then runs the handoff; resets the quitting state if the handoff fails. */
  readonly restart: (handoff: Effect.Effect<void, unknown>) => Effect.Effect<void, unknown>
  readonly persistence: {
    readonly get: Effect.Effect<{ version: string } | undefined, unknown>
    readonly set: (value: { version: string }) => Effect.Effect<void, unknown>
    readonly clear: Effect.Effect<void, unknown>
  }
  readonly changed: (state: UpdaterState) => void
}

// Ceilings for platform calls that can hang on a stalled socket (macOS waits for Squirrel's `update-downloaded`).
// The restart handoff has none here: ApplicationLifecycle bounds stopping and resuming the plugins, and
// `installAndRestart` bounds the handoff itself.
const CHECK_TIMEOUT_MS = 60_000

const STAGE_TIMEOUT_MS = 60 * 60_000

const EXTERNAL_TIMEOUT_MS = 30_000

/** Runs the update machine. Fibers it forks belong to the caller's scope; closing it settles every caller. */
export const make = Effect.fn("Updater.make")(function* (dependencies: Dependencies) {
  const runFork = Effect.runForkWith(yield* Effect.context())
  const platform = dependencies.platform
  const persisted = platform ? yield* dependencies.persistence.get : undefined

  const init = initUpdaterMachine({
    currentVersion: dependencies.currentVersion,
    enabled: !!platform,
    canExternalInstall: !!platform?.externalInstall,
    persistedVersion: persisted?.version,
  })

  const current = { state: init.state, view: toUpdaterState(init.state) }
  const queue: UpdaterMachineEvent[] = []
  const checks = new Map<number, Deferred.Deferred<UpdaterState, Error>>()
  const installs = new Map<number, Deferred.Deferred<void, Error>>()
  const attempts = new Map<number, Fiber.Fiber<unknown, unknown>>()
  const issued = { waiter: 0 }

  // Effects run in order, each isolated, so one that throws never stops the events and effects after it.
  const isolate = (run: () => void) =>
    void Promise.try(run).catch((error) =>
      runFork(Effect.logError("updater effect failed", { message: String(error) })),
    )

  // An event dispatched while another applies (a platform call that settles synchronously) waits its turn.
  const dispatch = (event: UpdaterMachineEvent) => {
    queue.push(event)

    if (queue.length > 1) return

    for (const next of queue) isolate(() => apply(next))
    queue.length = 0
  }

  const apply = (event: UpdaterMachineEvent) => {
    const step = transitionUpdater(current.state, event)
    current.state = step.state
    const view = toUpdaterState(step.state)

    if (step.state.status !== "disposed" && !sameView(current.view, view)) {
      runFork(Effect.logInfo("updater state changed", { from: current.view.status, to: view.status }))
      current.view = view
      isolate(() => dependencies.changed(view))
    }

    step.effects.forEach((effect) => isolate(() => perform(effect)))
  }

  const perform = (effect: UpdaterMachineEffect) => {
    if (effect.type === "checks.resolve")
      return effect.waiters.forEach((waiter) => settle(checks, waiter, Exit.succeed({ ...effect.state })))

    if (effect.type === "installs.resolve")
      return effect.waiters.forEach((waiter) => settle(installs, waiter, Exit.void))

    if (effect.type === "installs.reject")
      return effect.waiters.forEach((waiter) => settle(installs, waiter, Exit.fail(failureToError(effect.failure))))

    if (effect.type === "persistence.set")
      return void runFork(dependencies.persistence.set({ version: effect.version }))

    if (effect.type === "persistence.clear") return void runFork(dependencies.persistence.clear)

    if (effect.type === "log") {
      const log = effect.level === "info" ? Effect.logInfo : Effect.logWarning

      return void runFork(log(effect.message, effect.data))
    }

    if (effect.type === "attempt.cancel") {
      attempts.get(effect.attempt)?.interruptUnsafe()

      return void attempts.delete(effect.attempt)
    }

    // Only an enabled machine, which has a platform, starts platform work.
    if (!platform) return
    const attempt = effect.attempt

    if (effect.type === "platform.check")
      return track(
        attempt,
        bounded(platform.checkForUpdate, CHECK_TIMEOUT_MS, "Update check timed out"),
        (target) => ({ type: "check.succeeded", attempt, target }),
        (error) => ({ type: "check.failed", attempt, message: error.message }),
      )

    if (effect.type === "platform.stage")
      return track(
        attempt,
        bounded(
          platform.stageUpdate({ differential: effect.differential }),
          STAGE_TIMEOUT_MS,
          "Update download timed out",
        ),
        () => ({ type: "stage.succeeded", attempt }),
        (error) => ({ type: "stage.failed", attempt, message: error.message }),
      )

    if (effect.type === "platform.restart")
      return track(
        attempt,
        dependencies.restart(platform.installAndRestart),
        () => ({ type: "restart.succeeded", attempt }),
        (error) => ({ type: "restart.failed", attempt, error }),
      )

    track(
      attempt,
      bounded(
        platform.externalInstall?.(effect.url) ?? Effect.fail(failureToError({ kind: "external-unavailable" })),
        EXTERNAL_TIMEOUT_MS,
        "External installer did not open",
      ),
      () => ({ type: "external.succeeded", attempt }),
      (error) => ({ type: "external.failed", attempt, error }),
    )
  }

  // Platform work runs in its own fiber, never a caller's, so a caller that goes away leaves it running for the rest.
  const track = <A>(
    attempt: number,
    work: Effect.Effect<A, unknown>,
    succeeded: (value: A) => UpdaterMachineEvent,
    failed: (error: Error) => UpdaterMachineEvent,
  ) => {
    const fiber = runFork(work)
    attempts.set(attempt, fiber)
    fiber.addObserver((exit) => {
      attempts.delete(attempt)

      if (Exit.isSuccess(exit)) return dispatch(succeeded(exit.value))

      // A cancelled attempt reports nothing; the machine already moved on.
      if (Cause.hasInterruptsOnly(exit.cause)) return
      const error = Cause.squash(exit.cause)
      dispatch(failed(error instanceof Error ? error : new Error(String(error))))
    })
  }

  const request = <A>(
    waiters: Map<number, Deferred.Deferred<A, Error>>,
    type: "check.requested" | "install.requested",
  ) =>
    Effect.suspend(() => {
      issued.waiter += 1
      const waiter = issued.waiter
      const deferred = Deferred.makeUnsafe<A, Error>()
      waiters.set(waiter, deferred)
      // Claims the work before returning, so the state is already `installing` on the caller's next line.
      dispatch({ type, waiter })

      return Deferred.await(deferred).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            waiters.delete(waiter)
            dispatch({ type: "waiter.cancelled", waiter })
          }),
        ),
      )
    })

  const check = request<UpdaterState>(checks, "check.requested").pipe(Effect.orDie)
  const install = request<void>(installs, "install.requested")

  init.effects.forEach(perform)
  yield* Effect.addFinalizer(() => Effect.sync(() => dispatch({ type: "disposed" })))
  const starting = yield* check.pipe(Effect.forkScoped)
  yield* Effect.gen(function* () {
    yield* Effect.sleep("10 minutes")
    yield* check
  }).pipe(Effect.forever, Effect.forkScoped)

  return {
    check,
    install,
    state: () => current.view,
    started: Fiber.join(starting).pipe(Effect.orDie),
  }
})

function settle<A>(waiters: Map<number, Deferred.Deferred<A, Error>>, waiter: number, exit: Exit.Exit<A, Error>) {
  const deferred = waiters.get(waiter)
  waiters.delete(waiter)

  if (deferred) Deferred.doneUnsafe(deferred, exit)
}

function bounded<A>(work: Effect.Effect<A, unknown>, duration: number, message: string) {
  return work.pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.fail(new Error(message)) }))
}

function failureToError(failure: UpdaterFailure) {
  if (failure.kind === "not-ready") return new Error("Update is not ready to install")

  if (failure.kind === "external-unavailable") return new Error("External installer is unavailable")

  if (failure.kind === "disposed") return new Error("Updater stopped")

  return failure.error
}

function sameView(a: UpdaterState, b: UpdaterState) {
  return a.status === b.status && viewDetail(a) === viewDetail(b)
}

function viewDetail(view: UpdaterState) {
  if (view.status === "error") return view.message

  if (
    view.status === "downloading" ||
    view.status === "ready" ||
    view.status === "download-required" ||
    view.status === "installing"
  )
    return view.version

  return undefined
}

/** A silent check, then maybe a download of a newer release, while a staged update stays installable. */
export type StagedRefresh =
  | { readonly step: "checking"; readonly attempt: number; readonly checkWaiters: readonly number[] }
  | {
      readonly step: "staging"
      readonly attempt: number
      readonly nextVersion: string
      readonly checkWaiters: readonly number[]
    }

/** A silent check while an external download stays offered. */
export type ExternalRefresh = { readonly attempt: number; readonly checkWaiters: readonly number[] }

/**
 * The step an installation is at. A restart checks for a newer release, may stage it, then hands off to
 * `ApplicationLifecycle.restart`; `quitting` holds once the app quits into the installer. An external install checks
 * that its download is still current, then opens it.
 */
export type InstallingPlan =
  | (StagedRefresh & { readonly mode: "restart"; readonly version: string })
  | { readonly mode: "restart"; readonly version: string; readonly step: "restarting"; readonly attempt: number }
  | { readonly mode: "restart"; readonly version: string; readonly step: "quitting" }
  | {
      readonly mode: "external"
      readonly version: string
      readonly url: string
      readonly step: "checking"
      readonly attempt: number
      readonly checkWaiters: readonly number[]
    }
  | {
      readonly mode: "external"
      readonly version: string
      readonly url: string
      readonly step: "opening"
      readonly attempt: number
    }

type Meta = {
  readonly currentVersion: string
  readonly canExternalInstall: boolean
  /** The last attempt id issued; a result for any other attempt is stale. */
  readonly issued: number
  /**
   * The release electron-updater's cache holds, from an earlier download that was never installed. electron-updater
   * builds NSIS deltas against the running version's installer but reads the "old" blockmap from the last download, so
   * while this is set every delta would fail its checksum: download in full instead.
   */
  readonly cached: string | undefined
}

/**
 * The updater's lifecycle. Callers waiting on a check or an install are listed by waiter id in the phase that will
 * answer them; `issued` and each phase's `attempt` fence platform results.
 */
export type UpdaterMachineState =
  | { readonly status: "disabled" }
  | (Meta & { readonly status: "idle" })
  | (Meta & { readonly status: "checking"; readonly attempt: number; readonly checkWaiters: readonly number[] })
  | (Meta & {
      readonly status: "downloading"
      readonly attempt: number
      readonly version: string
      readonly checkWaiters: readonly number[]
    })
  | (Meta & { readonly status: "up-to-date" })
  | (Meta & { readonly status: "ready"; readonly version: string; readonly refresh?: StagedRefresh })
  | (Meta & {
      readonly status: "download-required"
      readonly version: string
      readonly url: string
      readonly refresh?: ExternalRefresh
    })
  | (Meta & {
      readonly status: "installing"
      readonly plan: InstallingPlan
      readonly installWaiters: readonly number[]
    })
  | (Meta & { readonly status: "error"; readonly message: string })
  | { readonly status: "disposed"; readonly last: UpdaterState }

type Active = Exclude<UpdaterMachineState, { readonly status: "disabled" | "disposed" }>

export type UpdaterMachineEvent =
  | { readonly type: "check.requested"; readonly waiter: number }
  | { readonly type: "install.requested"; readonly waiter: number }
  | { readonly type: "waiter.cancelled"; readonly waiter: number }
  | { readonly type: "check.succeeded"; readonly attempt: number; readonly target: UpdateTarget | undefined }
  | { readonly type: "check.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "stage.succeeded"; readonly attempt: number }
  | { readonly type: "stage.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "restart.succeeded"; readonly attempt: number }
  | { readonly type: "restart.failed"; readonly attempt: number; readonly error: Error }
  | { readonly type: "external.succeeded"; readonly attempt: number }
  | { readonly type: "external.failed"; readonly attempt: number; readonly error: Error }
  | { readonly type: "disposed" }

type Settled = Extract<UpdaterMachineEvent, { readonly attempt: number }>

export type UpdaterFailure =
  | { readonly kind: "not-ready" }
  | { readonly kind: "external-unavailable" }
  | { readonly kind: "disposed" }
  | { readonly kind: "error"; readonly error: Error }

export type UpdaterMachineEffect =
  | { readonly type: "platform.check"; readonly attempt: number }
  | { readonly type: "platform.stage"; readonly attempt: number; readonly differential: boolean }
  | { readonly type: "platform.restart"; readonly attempt: number }
  | { readonly type: "platform.external"; readonly attempt: number; readonly url: string }
  | { readonly type: "attempt.cancel"; readonly attempt: number }
  | { readonly type: "persistence.set"; readonly version: string }
  | { readonly type: "persistence.clear" }
  | { readonly type: "checks.resolve"; readonly waiters: readonly number[]; readonly state: UpdaterState }
  | { readonly type: "installs.resolve"; readonly waiters: readonly number[] }
  | { readonly type: "installs.reject"; readonly waiters: readonly number[]; readonly failure: UpdaterFailure }
  | {
      readonly type: "log"
      readonly level: "info" | "warning"
      readonly message: string
      readonly data: Readonly<Record<string, string>>
    }

export type UpdaterMachineTransition = {
  readonly state: UpdaterMachineState
  readonly effects: readonly UpdaterMachineEffect[]
}

export function initUpdaterMachine(input: {
  readonly currentVersion: string
  readonly enabled: boolean
  readonly canExternalInstall: boolean
  /** The release an earlier launch staged. */
  readonly persistedVersion: string | undefined
}): UpdaterMachineTransition {
  if (!input.enabled) return { state: { status: "disabled" }, effects: [] }
  const installed = input.persistedVersion === input.currentVersion

  return {
    state: {
      status: "idle",
      currentVersion: input.currentVersion,
      canExternalInstall: input.canExternalInstall,
      issued: 0,
      // Any other persisted release was downloaded by an earlier launch and never installed, so its blockmap is cached.
      cached: installed ? undefined : input.persistedVersion,
    },
    effects: installed ? [{ type: "persistence.clear" }] : [],
  }
}

export function transitionUpdater(state: UpdaterMachineState, event: UpdaterMachineEvent): UpdaterMachineTransition {
  if (state.status === "disposed") return afterDispose(state, event)

  if (event.type === "disposed") return dispose(state)

  if (state.status === "disabled") return disabled(state, event)

  if (event.type === "check.requested") return checkRequested(state, event.waiter)

  if (event.type === "install.requested") return installRequested(state, event.waiter)

  if (event.type === "waiter.cancelled") return waiterCancelled(state, event.waiter)

  if (event.attempt !== activeAttempt(state)) return unchanged(state)

  return settled(state, event)
}

/** What windows see. Always a fresh object. */
export function toUpdaterState(state: UpdaterMachineState): UpdaterState {
  if (state.status === "disposed") return { ...state.last }

  if (state.status === "downloading" || state.status === "ready" || state.status === "download-required")
    return { status: state.status, version: state.version }

  if (state.status === "installing") return { status: "installing", version: state.plan.version }

  if (state.status === "error") return { status: "error", message: state.message }

  return { status: state.status }
}

function afterDispose(state: Extract<UpdaterMachineState, { status: "disposed" }>, event: UpdaterMachineEvent) {
  if (event.type === "check.requested") return withChecks(state, [event.waiter])

  if (event.type === "install.requested")
    return unchanged(state, [rejectInstalls([event.waiter], { kind: "disposed" })])

  return unchanged(state)
}

// Platform work still running is cancelled and every caller hears now. The restart handoff is ApplicationLifecycle's
// to settle, so it is left running.
function dispose(state: Exclude<UpdaterMachineState, { status: "disposed" }>): UpdaterMachineTransition {
  const last = toUpdaterState(state)

  if (state.status === "disabled") return { state: { status: "disposed", last }, effects: [] }
  const attempt = activeAttempt(state)
  const cancel = attempt === undefined || restarting(state) ? [] : [{ type: "attempt.cancel" as const, attempt }]
  const installs = state.status === "installing" ? state.installWaiters : []

  return withChecks({ status: "disposed", last }, checkWaitersOf(state), [
    ...cancel,
    ...(installs.length > 0 ? [rejectInstalls(installs, { kind: "disposed" })] : []),
  ])
}

function disabled(state: Extract<UpdaterMachineState, { status: "disabled" }>, event: UpdaterMachineEvent) {
  if (event.type === "check.requested") return withChecks(state, [event.waiter])

  if (event.type === "install.requested")
    return unchanged(state, [rejectInstalls([event.waiter], { kind: "not-ready" })])

  return unchanged(state)
}

function checkRequested(state: Active, waiter: number): UpdaterMachineTransition {
  const attempt = state.issued + 1

  if (state.status === "idle" || state.status === "up-to-date" || state.status === "error")
    return {
      state: { ...meta(state), issued: attempt, status: "checking", attempt, checkWaiters: [waiter] },
      effects: [{ type: "platform.check", attempt }],
    }

  if (state.status === "checking" || state.status === "downloading")
    return unchanged({ ...state, checkWaiters: [...state.checkWaiters, waiter] })

  // A staged or offered update stays on screen while a silent check runs; later checks join it.
  if (state.status === "ready" || state.status === "download-required") {
    if (state.refresh) return unchanged(withRefreshWaiters(state, [...state.refresh.checkWaiters, waiter]))

    return {
      state:
        state.status === "ready"
          ? { ...state, issued: attempt, refresh: { step: "checking", attempt, checkWaiters: [waiter] } }
          : { ...state, issued: attempt, refresh: { attempt, checkWaiters: [waiter] } },
      effects: [{ type: "platform.check", attempt }],
    }
  }

  // An installation is underway: report it without checking again.
  return withChecks(state, [waiter])
}

// The installation claims the updater in the same event, so a check that starts meanwhile never runs a second
// platform check. A silent check or download already running becomes the installation's own.
function installRequested(state: Active, waiter: number): UpdaterMachineTransition {
  if (state.status === "installing") return unchanged({ ...state, installWaiters: [...state.installWaiters, waiter] })

  const attempt = state.issued + 1

  if (state.status === "ready") {
    if (state.refresh)
      return unchanged({
        ...meta(state),
        status: "installing",
        plan: { ...state.refresh, mode: "restart", version: state.version },
        installWaiters: [waiter],
      })

    return {
      state: {
        ...meta(state),
        issued: attempt,
        status: "installing",
        plan: { mode: "restart", version: state.version, step: "checking", attempt, checkWaiters: [] },
        installWaiters: [waiter],
      },
      effects: [{ type: "platform.check", attempt }],
    }
  }

  if (state.status !== "download-required") return unchanged(state, [rejectInstalls([waiter], { kind: "not-ready" })])

  if (!state.canExternalInstall) return unchanged(state, [rejectInstalls([waiter], { kind: "external-unavailable" })])
  const plan = { mode: "external", version: state.version, url: state.url, step: "checking" } as const

  if (state.refresh)
    return unchanged({
      ...meta(state),
      status: "installing",
      plan: { ...plan, attempt: state.refresh.attempt, checkWaiters: state.refresh.checkWaiters },
      installWaiters: [waiter],
    })

  return {
    state: {
      ...meta(state),
      issued: attempt,
      status: "installing",
      plan: { ...plan, attempt, checkWaiters: [] },
      installWaiters: [waiter],
    },
    effects: [{ type: "platform.check", attempt }],
  }
}

// A caller that stops waiting leaves the shared work running for everyone else.
function waiterCancelled(state: Active, waiter: number): UpdaterMachineTransition {
  if (state.status === "checking" || state.status === "downloading") {
    const checkWaiters = without(state.checkWaiters, waiter)

    return unchanged(checkWaiters === state.checkWaiters ? state : { ...state, checkWaiters })
  }

  if ((state.status === "ready" || state.status === "download-required") && state.refresh) {
    const checkWaiters = without(state.refresh.checkWaiters, waiter)

    return unchanged(checkWaiters === state.refresh.checkWaiters ? state : withRefreshWaiters(state, checkWaiters))
  }

  if (state.status !== "installing") return unchanged(state)
  const installWaiters = without(state.installWaiters, waiter)
  const checks = checkWaitersOf(state)
  const checkWaiters = without(checks, waiter)

  if (installWaiters === state.installWaiters && checkWaiters === checks) return unchanged(state)

  return unchanged({
    ...state,
    plan: "checkWaiters" in state.plan ? { ...state.plan, checkWaiters } : state.plan,
    installWaiters,
  })
}

function settled(state: Active, event: Settled): UpdaterMachineTransition {
  if (state.status === "checking") {
    if (event.type === "check.succeeded") return discovered(state, event.target, state.checkWaiters)

    if (event.type === "check.failed")
      return withChecks({ ...meta(state), status: "error", message: event.message }, state.checkWaiters)
  }

  if (state.status === "downloading") {
    if (event.type === "stage.succeeded")
      return withChecks(
        { ...meta(state), cached: state.version, status: "ready", version: state.version },
        state.checkWaiters,
        [{ type: "persistence.set", version: state.version }],
      )

    if (event.type === "stage.failed")
      return withChecks({ ...meta(state), status: "error", message: event.message }, state.checkWaiters)
  }

  if (state.status === "ready" && state.refresh) return refreshSettled(state, state.refresh, event)

  if (state.status === "download-required" && state.refresh) {
    if (event.type === "check.succeeded") return discovered(state, event.target, state.refresh.checkWaiters)

    if (event.type === "check.failed")
      return withChecks({ ...state, refresh: undefined }, state.refresh.checkWaiters, [
        externalRefreshFailed(event.message),
      ])
  }

  if (state.status === "installing" && state.plan.mode === "restart") return restartSettled(state, state.plan, event)

  if (state.status === "installing" && state.plan.mode === "external") return externalSettled(state, state.plan, event)

  return unchanged(state)
}

function refreshSettled(
  state: Extract<Active, { status: "ready" }>,
  refresh: StagedRefresh,
  event: Settled,
): UpdaterMachineTransition {
  const ready = { ...state, refresh: undefined }

  if (refresh.step === "checking" && event.type === "check.succeeded") {
    if (keepsStaged(state, state.version, event.target)) return withChecks(ready, refresh.checkWaiters)

    if (event.target?.mode !== "restart") return discovered(state, event.target, refresh.checkWaiters)
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        refresh: { step: "staging", attempt, nextVersion: event.target.version, checkWaiters: refresh.checkWaiters },
      },
      effects: stageEffects(state, attempt, event.target.version),
    }
  }

  if (refresh.step === "staging" && event.type === "stage.succeeded")
    return withChecks({ ...ready, cached: refresh.nextVersion, version: refresh.nextVersion }, refresh.checkWaiters, [
      { type: "persistence.set", version: refresh.nextVersion },
    ])

  if (event.type === "check.failed" || event.type === "stage.failed")
    return withChecks(ready, refresh.checkWaiters, [stagedRefreshFailed(state.version, event.message)])

  return unchanged(state)
}

// The installation hands off only for a release it keeps or has just staged. A check that finds an external
// download instead cancels the restart, so the app never quits into a superseded staged update.
function restartSettled(
  state: Extract<Active, { status: "installing" }>,
  plan: Extract<InstallingPlan, { mode: "restart" }>,
  event: Settled,
): UpdaterMachineTransition {
  if (plan.step === "checking" && event.type === "check.succeeded") {
    if (keepsStaged(state, plan.version, event.target)) return restart(state, plan.version, plan.checkWaiters)

    if (event.target?.mode === "external") {
      const next = discovered(state, event.target, plan.checkWaiters)

      return {
        state: next.state,
        effects: [...next.effects, { type: "installs.resolve", waiters: state.installWaiters }],
      }
    }

    const nextVersion = event.target?.version ?? plan.version
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        plan: {
          mode: "restart",
          version: plan.version,
          step: "staging",
          attempt,
          nextVersion,
          checkWaiters: plan.checkWaiters,
        },
      },
      effects: stageEffects(state, attempt, nextVersion),
    }
  }

  // The staged release still installs when the last-minute check or download fails.
  if (
    (plan.step === "checking" && event.type === "check.failed") ||
    (plan.step === "staging" && event.type === "stage.failed")
  )
    return restart(state, plan.version, plan.checkWaiters, [stagedRefreshFailed(plan.version, event.message)])

  if (plan.step === "staging" && event.type === "stage.succeeded")
    return restart({ ...state, cached: plan.nextVersion }, plan.nextVersion, plan.checkWaiters, [
      { type: "persistence.set", version: plan.nextVersion },
    ])

  if (plan.step === "restarting" && event.type === "restart.succeeded")
    return unchanged(
      { ...state, plan: { mode: "restart", version: plan.version, step: "quitting" }, installWaiters: [] },
      [{ type: "installs.resolve", waiters: state.installWaiters }],
    )

  // ApplicationLifecycle resumed the other plugins before rejecting, so the user can retry.
  if (plan.step === "restarting" && event.type === "restart.failed")
    return unchanged({ ...meta(state), status: "ready", version: plan.version }, [
      rejectInstalls(state.installWaiters, { kind: "error", error: event.error }),
    ])

  return unchanged(state)
}

// The external installer opens the current download only. Once it opened, or failed to, the download stays offered:
// the app keeps running, so the user can open it again.
function externalSettled(
  state: Extract<Active, { status: "installing" }>,
  plan: Extract<InstallingPlan, { mode: "external" }>,
  event: Settled,
): UpdaterMachineTransition {
  if (plan.step === "checking" && event.type === "check.succeeded") {
    if (event.target?.mode === "external") return open(state, event.target.version, event.target.url, plan.checkWaiters)
    const next = discovered(state, event.target, plan.checkWaiters)

    return {
      state: next.state,
      effects: [...next.effects, rejectInstalls(state.installWaiters, { kind: "external-unavailable" })],
    }
  }

  if (plan.step === "checking" && event.type === "check.failed")
    return open(state, plan.version, plan.url, plan.checkWaiters, [externalRefreshFailed(event.message)])

  const offered = { ...meta(state), status: "download-required" as const, version: plan.version, url: plan.url }

  if (plan.step === "opening" && event.type === "external.succeeded")
    return unchanged(offered, [{ type: "installs.resolve", waiters: state.installWaiters }])

  if (plan.step === "opening" && event.type === "external.failed")
    return unchanged(offered, [rejectInstalls(state.installWaiters, { kind: "error", error: event.error })])

  return unchanged(state)
}

// What a fresh check found when no staged update is kept.
function discovered(state: Active, target: UpdateTarget | undefined, checkWaiters: readonly number[]) {
  if (!target || (target.mode === "restart" && target.version === state.currentVersion))
    return withChecks({ ...meta(state), status: "up-to-date" }, checkWaiters, [{ type: "persistence.clear" }])

  if (target.mode === "external")
    return withChecks(
      { ...meta(state), status: "download-required", version: target.version, url: target.url },
      checkWaiters,
      [{ type: "persistence.clear" }],
    )
  const attempt = state.issued + 1

  return {
    state: { ...meta(state), issued: attempt, status: "downloading", attempt, version: target.version, checkWaiters },
    effects: stageEffects(state, attempt, target.version),
  } satisfies UpdaterMachineTransition
}

function restart(
  state: Extract<Active, { status: "installing" }>,
  version: string,
  checkWaiters: readonly number[],
  effects: readonly UpdaterMachineEffect[] = [],
): UpdaterMachineTransition {
  const attempt = state.issued + 1

  return withChecks(
    { ...state, issued: attempt, plan: { mode: "restart", version, step: "restarting", attempt } },
    checkWaiters,
    [...effects, { type: "platform.restart", attempt }],
  )
}

function open(
  state: Extract<Active, { status: "installing" }>,
  version: string,
  url: string,
  checkWaiters: readonly number[],
  effects: readonly UpdaterMachineEffect[] = [],
): UpdaterMachineTransition {
  const attempt = state.issued + 1

  return withChecks(
    { ...state, issued: attempt, plan: { mode: "external", version, url, step: "opening", attempt } },
    checkWaiters,
    [...effects, { type: "platform.external", attempt, url }],
  )
}

function keepsStaged(state: Active, staged: string, target: UpdateTarget | undefined) {
  return (
    !target || (target.mode === "restart" && (target.version === staged || target.version === state.currentVersion))
  )
}

function stageEffects(state: Active, attempt: number, version: string): UpdaterMachineEffect[] {
  const stage = { type: "platform.stage", attempt, differential: !state.cached } as const

  if (!state.cached) return [stage]

  return [
    {
      type: "log",
      level: "info",
      message: "skipping differential download, updater cache is stale",
      data: { current: state.currentVersion, staged: state.cached, version },
    },
    stage,
  ]
}

function activeAttempt(state: Active) {
  if (state.status === "checking" || state.status === "downloading") return state.attempt

  if (state.status === "ready" || state.status === "download-required") return state.refresh?.attempt

  if (state.status === "installing" && state.plan.step !== "quitting") return state.plan.attempt

  return undefined
}

function restarting(state: Active) {
  return state.status === "installing" && state.plan.step === "restarting"
}

function checkWaitersOf(state: Active): readonly number[] {
  if (state.status === "checking" || state.status === "downloading") return state.checkWaiters

  if (state.status === "ready" || state.status === "download-required") return state.refresh?.checkWaiters ?? []

  if (state.status === "installing" && "checkWaiters" in state.plan) return state.plan.checkWaiters

  return []
}

function withRefreshWaiters(
  state: Extract<Active, { status: "ready" | "download-required" }>,
  checkWaiters: readonly number[],
): UpdaterMachineState {
  if (state.status === "ready" && state.refresh) return { ...state, refresh: { ...state.refresh, checkWaiters } }

  if (state.status === "download-required" && state.refresh)
    return { ...state, refresh: { ...state.refresh, checkWaiters } }

  return state
}

function meta(state: Active): Meta {
  return {
    currentVersion: state.currentVersion,
    canExternalInstall: state.canExternalInstall,
    issued: state.issued,
    cached: state.cached,
  }
}

function stagedRefreshFailed(staged: string, message: string): UpdaterMachineEffect {
  return {
    type: "log",
    level: "warning",
    message: "updater refresh failed, keeping staged update",
    data: { staged, message },
  }
}

function externalRefreshFailed(message: string): UpdaterMachineEffect {
  return {
    type: "log",
    level: "warning",
    message: "external updater refresh failed, keeping download available",
    data: { message },
  }
}

function rejectInstalls(waiters: readonly number[], failure: UpdaterFailure): UpdaterMachineEffect {
  return { type: "installs.reject", waiters, failure }
}

function without(waiters: readonly number[], waiter: number) {
  return waiters.includes(waiter) ? waiters.filter((item) => item !== waiter) : waiters
}

// Answers `waiters` with what the next state shows, after the transition's other effects.
function withChecks(
  state: UpdaterMachineState,
  waiters: readonly number[],
  effects: readonly UpdaterMachineEffect[] = [],
): UpdaterMachineTransition {
  if (waiters.length === 0) return { state, effects }

  return { state, effects: [...effects, { type: "checks.resolve", waiters, state: toUpdaterState(state) }] }
}

function unchanged(
  state: UpdaterMachineState,
  effects: readonly UpdaterMachineEffect[] = [],
): UpdaterMachineTransition {
  return { state, effects }
}
