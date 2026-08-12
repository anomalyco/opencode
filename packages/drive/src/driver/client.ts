import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Ref from "effect/Ref"
import * as Semaphore from "effect/Semaphore"
import * as Scope from "effect/Scope"
import * as Deferred from "effect/Deferred"
import type * as OpenCodeInstance from "../instance/runtime.js"
import type * as SimulationConnector from "../simulation/connector.js"
import type { Frontend } from "../client/protocol.js"
import { finalizeRecording } from "../recording/finalize.js"
import { error, type OpenCodeDriverError } from "./error.js"
import * as OpenCodeUi from "./ui.js"
import * as SharedEffect from "./shared.js"

export interface TuiOptions {
  readonly recording?: boolean
  readonly viewport?: Frontend.ResizeParams
}

export interface Tui {
  readonly ui: OpenCodeUi.Ui
  readonly recording?: Recording
  readonly close: () => Effect.Effect<void>
}

export interface Recording {
  readonly path: string
  readonly timeline: string
  readonly finish: () => Effect.Effect<
    string,
    OpenCodeDriverError | OpenCodeUi.OperationError
  >
}

interface ManagedTui extends Tui {
  readonly compatibility: SimulationConnector.EndpointCompatibility
  readonly _exitCode: Effect.Effect<number, OpenCodeDriverError>
  readonly _recording?: {
    readonly finishTimeline: Effect.Effect<
      string,
      OpenCodeDriverError | OpenCodeUi.OperationError
    >
    readonly exportRecording: Effect.Effect<
      string,
      OpenCodeDriverError | OpenCodeUi.OperationError
    >
  }
}

export const make = Effect.fn("OpenCodeTui.make")(function* (
  instance: OpenCodeInstance.Instance,
  visible: boolean,
  identity: string,
  options: TuiOptions,
  connector: SimulationConnector.Interface,
  compatibility?: SimulationConnector.CompatibilityPolicy,
) {
  if (visible && options.recording)
    return yield* Effect.fail(
      error(
        "tui.launch",
        "recording requires a headless OpenCode TUI",
      ),
    )
  const launched = yield* Effect.acquireRelease(
    instance.launchTui(identity, {
      record: options.recording,
      viewport: options.viewport,
    }).pipe(
      Effect.mapError((cause) => error("tui.launch", cause)),
    ),
    (client) =>
      client.close.pipe(
        Effect.catchCause((cause) =>
          Effect.logError("OpenCode TUI cleanup failed", cause),
        ),
      ),
  )
  const connection = yield* connector.ui(launched.endpoint, { compatibility })
  const ui = OpenCodeUi.make(connection)
  yield* ui.waitFor((state) => state.focused.editor, {
    timeout: 30_000,
    interval: 50,
  })

  const recording = launched.recording
  let managedRecording: ManagedTui["_recording"]
  if (recording !== undefined) {
    const finishTimeline = yield* SharedEffect.make(
      Effect.gen(function* () {
        const timeline = yield* ui.finishRecording()
        if (timeline !== recording.timeline)
          return yield* Effect.fail(
            error(
              "recording.finish",
              `OpenCode returned an unexpected recording path: ${timeline}`,
            ),
          )
        return timeline
      }),
    )
    const exportFinishedRecording = yield* SharedEffect.make(
      Effect.flatMap(finishTimeline, (timeline) =>
        Effect.tryPromise({
          try: (signal) => finalizeRecording(timeline, recording, { signal }),
          catch: (cause) => error("recording.export", cause),
        }),
      ),
    )
    managedRecording = {
      finishTimeline,
      exportRecording: exportFinishedRecording,
    }
    yield* Effect.addFinalizer(() =>
      finishTimeline.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.logError("OpenCode TUI recording finalization failed", cause),
        ),
      ),
    )
  }

  return {
    ui,
    compatibility: connection.compatibility,
    close: () => Effect.void,
    _exitCode: launched.process.exitCode.pipe(
      Effect.mapError((cause) => error("tui.exit", cause)),
    ),
    ...(recording === undefined || managedRecording === undefined
      ? {}
      : {
          recording: {
            path: recording.video,
            timeline: recording.timeline,
            finish: () => managedRecording.exportRecording,
          },
          _recording: managedRecording,
        }),
  } satisfies ManagedTui
})

export interface Tuis {
  readonly launch: {
    (options?: TuiOptions): Effect.Effect<Tui, TuiLaunchError>
    /** Launches a named TUI. The name is released when that TUI closes. */
    (
      name: string,
      options?: TuiOptions,
    ): Effect.Effect<Tui, TuiLaunchError>
  }
}

export type TuiLaunchError =
  | OpenCodeDriverError
  | SimulationConnector.SimulationCompatibilityError
  | OpenCodeUi.OperationError
  | OpenCodeUi.UiPredicateError
  | OpenCodeUi.UiWaitOptionsError

export interface UnexpectedExit {
  readonly name: string
  readonly status: number
}

export interface Control extends Tuis {
  readonly compatibility: Effect.Effect<
    ReadonlyArray<SimulationConnector.EndpointCompatibility>
  >
  readonly unexpectedExit: Effect.Effect<UnexpectedExit>
  readonly settle: () => Effect.Effect<
    ReadonlyArray<string>,
    OpenCodeDriverError | OpenCodeUi.OperationError
  >
}

export const makeTuis = Effect.fn("OpenCodeTuis.make")(function* (
  instance: OpenCodeInstance.Instance,
  visible: boolean,
  connector: SimulationConnector.Interface,
  compatibilityPolicy?: SimulationConnector.CompatibilityPolicy,
) {
  const parentScope = yield* Scope.Scope
  const tuisScope = yield* Scope.fork(parentScope, "parallel")
  const lock = yield* Semaphore.make(1)
  let closed = false
  let recordings: ReadonlyArray<
    NonNullable<ManagedTui["_recording"]>
  > = []
  const nextIdentity = yield* Ref.make(0)
  let active: ReadonlyMap<string, Scope.Scope> = new Map()
  const unexpectedExit = yield* Deferred.make<UnexpectedExit>()
  let compatibility: ReadonlyArray<
    SimulationConnector.EndpointCompatibility
  > = []

  const launchNamed = Effect.fn("OpenCodeTuis.launchNamed")(function* (
    identity: string,
    options: TuiOptions = {},
  ) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        if (closed)
          return yield* Effect.fail(
            error("tui.launch", "OpenCode TUIs are closed"),
          )
        if (active.has(identity))
          return yield* Effect.fail(
            error("tui.launch", `TUI "${identity}" is already connected`),
          )
        const scope = yield* Scope.fork(tuisScope)
        active = new Map(active).set(identity, scope)
        const client = yield* make(
          instance,
          visible,
          identity,
          options,
          connector,
          compatibilityPolicy,
        ).pipe(
          Scope.provide(scope),
          Effect.onError(() =>
            Effect.sync(() => {
              const next = new Map(active)
              next.delete(identity)
              active = next
            }).pipe(Effect.andThen(Scope.close(scope, Exit.void))),
          ),
        )
        compatibility = [...compatibility, client.compatibility]
        const recording = client._recording
        if (recording !== undefined) recordings = [...recordings, recording]
        const claim = lock.withPermit(
          Effect.sync(() => {
            if (active.get(identity) !== scope) return false
            const next = new Map(active)
            next.delete(identity)
            active = next
            return true
          }),
        )
        const release = claim.pipe(
          Effect.flatMap((owned) =>
            owned ? Scope.close(scope, Exit.void) : Effect.void,
          ),
        )
        yield* client._exitCode.pipe(
          Effect.flatMap((status) =>
            claim.pipe(
              Effect.flatMap((owned) =>
                owned
                  ? Deferred.succeed(unexpectedExit, {
                      name: identity,
                      status,
                    }).pipe(
                      Effect.andThen(Scope.close(scope, Exit.void)),
                    )
                  : Effect.void,
              ),
            ),
          ),
          Effect.catchCause(() => Effect.void),
          Effect.forkIn(tuisScope),
        )
        const publicTui: Tui = {
          ui: client.ui,
          ...(client.recording === undefined
            ? {}
            : { recording: client.recording }),
          close: () => release,
        }
        return publicTui
      }),
    )
  })

  function launch(options?: TuiOptions): Effect.Effect<Tui, TuiLaunchError>
  function launch(
    name: string,
    options?: TuiOptions,
  ): Effect.Effect<Tui, TuiLaunchError>
  function launch(
    nameOrOptions: string | TuiOptions = {},
    options: TuiOptions = {},
  ) {
    return typeof nameOrOptions === "string"
      ? launchNamed(nameOrOptions, options)
      : Ref.getAndUpdate(nextIdentity, (value) => value + 1).pipe(
          Effect.flatMap((identity) =>
            launchNamed(String(identity), nameOrOptions),
          ),
        )
  }

  const finishTimelines = yield* SharedEffect.make(
    Effect.gen(function* () {
      const active = yield* lock.withPermit(
        Effect.sync(() => {
          closed = true
          return recordings
        }),
      )
      const finished = yield* Effect.forEach(active, (recording) =>
        Effect.exit(recording.finishTimeline), {
        concurrency: "unbounded",
      })
      yield* Scope.close(tuisScope, Exit.void)
      return { active, finished }
    }),
  )

  const settle = Effect.fn("OpenCodeTuis.settle")(function* () {
    const { active, finished } = yield* finishTimelines
    const exported = yield* Effect.forEach(active, (recording, index) =>
      Exit.isSuccess(finished[index]!)
        ? Effect.exit(recording.exportRecording).pipe(
            Effect.map((result): Exit.Exit<
              string | undefined,
              OpenCodeDriverError | OpenCodeUi.OperationError
            > => result),
          )
        : Effect.succeed(Exit.succeed<string | undefined>(undefined)), {
      concurrency: 2,
    })
    let failure: Cause.Cause<
      OpenCodeDriverError | OpenCodeUi.OperationError
    > | undefined
    for (const result of [...finished, ...exported]) {
      if (!Exit.isFailure(result)) continue
      failure = failure === undefined
        ? result.cause
        : Cause.combine(failure, result.cause)
    }
    if (failure !== undefined)
      return yield* Effect.failCause(failure)
    return exported.flatMap((result) =>
      Exit.isSuccess(result) && result.value !== undefined
        ? [result.value]
        : [],
    )
  })

  return {
    launch,
    unexpectedExit: Deferred.await(unexpectedExit),
    compatibility: Effect.sync(() => compatibility),
    settle,
  } satisfies Control
})

export * as OpenCodeTui from "./client.js"
