import { Deferred, Effect, Exit, Fiber } from "effect"
import type { UpdaterState } from "./contract"

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

/** The update state machine. Fibers it forks belong to the caller's scope. */
export const make = Effect.fn("Updater.make")(function* (dependencies: Dependencies) {
  const runFork = Effect.runForkWith(yield* Effect.context())
  let state: UpdaterState = dependencies.platform ? { status: "idle" } : { status: "disabled" }
  let pending: Deferred.Deferred<UpdaterState> | undefined
  let installing: Deferred.Deferred<void, unknown> | undefined

  const transition = (next: UpdaterState) => {
    runFork(Effect.logInfo("updater state changed", { from: state.status, to: next.status }))
    state = next
    dependencies.changed(state)

    return state
  }

  // electron-updater builds NSIS deltas against the installer of the running version but reads the "old" blockmap from
  // the last download. Once a release is staged without installing, the two no longer match and every later delta fails
  // its checksum before falling back to a full download, so remember which release the cache holds and skip the attempt.
  let downloaded: string | undefined
  let target: UpdateTarget | undefined

  const stage = (platform: Platform, version: string) =>
    Effect.gen(function* () {
      if (downloaded)
        yield* Effect.logInfo("skipping differential download, updater cache is stale", {
          current: dependencies.currentVersion,
          staged: downloaded,
          version,
        })
      yield* platform.stageUpdate({ differential: !downloaded })
      downloaded = version
      yield* dependencies.persistence.set({ version })
    })

  const findAndStage = (platform: Platform) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => transition({ status: "checking" }))
      const next = yield* platform.checkForUpdate

      if (!next || (next.mode === "restart" && next.version === dependencies.currentVersion)) {
        yield* dependencies.persistence.clear

        return transition({ status: "up-to-date" })
      }

      target = next

      if (next.mode === "external") {
        yield* dependencies.persistence.clear

        return transition({ status: "download-required", version: next.version })
      }

      transition({ status: "downloading", version: next.version })
      yield* stage(platform, next.version)

      return transition({ status: "ready", version: next.version })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
        ),
      ),
    )

  const refreshStaged = (platform: Platform, staged: string) =>
    Effect.gen(function* () {
      const next = yield* platform.checkForUpdate

      if (!next) return state
      target = next

      if (next.mode === "external") {
        yield* dependencies.persistence.clear

        return transition({ status: "download-required", version: next.version })
      }

      if (next.version === staged || next.version === dependencies.currentVersion) return state
      yield* stage(platform, next.version)

      return transition({ status: installing ? "installing" : "ready", version: next.version })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          runFork(
            Effect.logWarning("updater refresh failed, keeping staged update", {
              staged,
              message: error instanceof Error ? error.message : String(error),
            }),
          )

          return state
        }),
      ),
    )

  const refreshExternal = (platform: Platform) =>
    Effect.gen(function* () {
      const next = yield* platform.checkForUpdate

      if (!next || next.mode !== "external") return state
      target = next

      if (state.status === "download-required" && state.version === next.version) return state

      return transition({ status: "download-required", version: next.version })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          runFork(
            Effect.logWarning("external updater refresh failed, keeping download available", {
              message: error instanceof Error ? error.message : String(error),
            }),
          )

          return state
        }),
      ),
    )

  const check = Effect.suspend(() => {
    const platform = dependencies.platform

    if (!platform || state.status === "installing") return Effect.succeed(state)

    if (pending) return Deferred.await(pending)
    const deferred = Deferred.makeUnsafe<UpdaterState>()
    pending = deferred

    const update =
      state.status === "ready"
        ? refreshStaged(platform, state.version)
        : state.status === "download-required"
          ? refreshExternal(platform)
          : findAndStage(platform)

    return update.pipe(
      Effect.tap((result) => Deferred.succeed(deferred, result)),
      Effect.ensuring(Effect.sync(() => (pending = undefined))),
    )
  })

  const install = Effect.suspend(() => {
    if (installing) return Deferred.await(installing)
    const platform = dependencies.platform

    if (!platform) return Effect.fail(new Error("Update is not ready to install"))

    if (state.status === "download-required") {
      const staged = state.version
      const deferred = Deferred.makeUnsafe<void, unknown>()
      installing = deferred

      return Effect.gen(function* () {
        yield* pending ? Deferred.await(pending) : refreshExternal(platform)

        if (!target || target.mode !== "external" || !platform.externalInstall)
          return yield* Effect.fail(new Error("External installer is unavailable"))
        transition({ status: "installing", version: target.version })

        return yield* platform.externalInstall(target.url)
      }).pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Deferred.done(deferred, exit).pipe(
            Effect.andThen(
              Effect.sync(() => {
                installing = undefined

                if (state.status === "installing")
                  transition({ status: "download-required", version: target?.version ?? staged })
              }),
            ),
            Effect.andThen(Deferred.await(deferred)),
          ),
        ),
      )
    }

    if (state.status !== "ready") return Effect.fail(new Error("Update is not ready to install"))
    const staged = state.version
    transition({ status: "installing", version: staged })
    const deferred = Deferred.makeUnsafe<void, unknown>()
    installing = deferred

    return Effect.gen(function* () {
      yield* pending ? Deferred.await(pending) : refreshStaged(platform, staged)
      yield* dependencies.restart(platform.installAndRestart)

      // The app is quitting into the installer.
      return yield* Effect.never
    }).pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Deferred.done(deferred, exit).pipe(
          Effect.andThen(
            Effect.sync(() => {
              installing = undefined

              if (Exit.isFailure(exit) && state.status === "installing") {
                transition({ status: "ready", version: state.version })
              }
            }),
          ),
          Effect.andThen(Deferred.await(deferred)),
        ),
      ),
    )
  })

  const start = Effect.gen(function* () {
    const ready = yield* dependencies.persistence.get

    if (ready?.version === dependencies.currentVersion) yield* dependencies.persistence.clear

    // Any other persisted target was downloaded by an earlier launch and never installed, so its blockmap is cached.
    if (ready && ready.version !== dependencies.currentVersion) downloaded = ready.version
    yield* check
  })

  const starting = yield* start.pipe(Effect.forkScoped)
  yield* Effect.gen(function* () {
    yield* Effect.sleep("10 minutes")
    yield* check
  }).pipe(Effect.forever, Effect.forkScoped)

  return {
    check,
    install,
    state: () => state,
    started: Fiber.join(starting).pipe(Effect.orDie),
  }
})
