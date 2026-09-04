export * as LocationWatcher from "./location-watcher.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Cause, Context, Effect, Exit, Layer, Scope, Semaphore, Stream } from "effect"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import path from "path"
import { Bus } from "../bus.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Git } from "../git.js"
import { Location } from "../location.js"
import { Plugin } from "../plugin.js"
import { LocationWatcherPolicy } from "./location-watcher-policy.js"
import { Watcher } from "./watcher.js"

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationWatcher") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const watcher = yield* Watcher.Service
    const bus = yield* Bus.Service
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const policy = yield* LocationWatcherPolicy.Service
    const publish = (update: { type: "create" | "update" | "delete"; path: string }) =>
      bus.publish(FileSystem.Event.Changed, {
        file: update.path,
        event: update.type === "create" ? "add" : update.type === "update" ? "change" : "unlink",
      })
    const target = yield* Effect.cached(
      Effect.gen(function* () {
        if (location.vcs?.type === "git") {
          const resolved = (yield* git.repo.discover(location.directory))?.gitDirectory
          const vcs = resolved ? yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved)) : undefined
          if (vcs) return { path: path.join(vcs, "HEAD"), aliases: [".git", vcs, ...(resolved ? [resolved] : [])] }
        }
        if (location.vcs?.type === "hg") {
          const store = location.vcs.store
          const vcs = yield* fs.realPath(store).pipe(Effect.orElseSucceed(() => store))
          return { path: path.join(vcs, "branch"), aliases: [".hg", vcs] }
        }
      }).pipe(
        Effect.withSpan("LocationWatcher.target", { attributes: { directory: location.directory } }),
        Effect.catchCause((cause) =>
          Effect.logError("failed to resolve location watcher target", { cause }).pipe(Effect.as(undefined)),
        ),
      ),
    )
    const lock = Semaphore.makeUnsafe(1)
    let stopped = false
    let active: { path: string; scope: Scope.Closeable } | undefined
    const reconcile = () =>
      lock.withPermit(
        Effect.gen(function* () {
          if (stopped) return
          const resolved = yield* target
          const ignore = policy.current()
          const next = resolved && !resolved.aliases.some((alias) => ignore.includes(alias)) ? resolved.path : undefined
          if (active?.path === next) return
          if (active) yield* Scope.close(active.scope, Exit.void)
          active = undefined
          if (!next) return
          const scope = yield* Scope.make()
          active = { path: next, scope }
          yield* Effect.gen(function* () {
            const updates = yield* watcher.subscribe({ path: next, type: "file" })
            yield* Stream.runForEach(updates, publish)
          }).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              (cause) => Effect.logError("location watcher subscription failed", { path: next, cause }),
            ),
            Effect.forkIn(scope, { startImmediately: true }),
          )
        }).pipe(Effect.withSpan("LocationWatcher.reconcile", { attributes: { directory: location.directory } })),
      )
    yield* Effect.addFinalizer(() =>
      lock.withPermit(
        Effect.gen(function* () {
          stopped = true
          if (active) yield* Scope.close(active.scope, Exit.void)
          active = undefined
        }),
      ),
    )
    yield* policy.observe(reconcile)
    yield* Effect.gen(function* () {
      yield* Plugin.awaitActivation
      yield* reconcile()
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        (cause) => Effect.logError("failed to start location watcher", { cause }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({})
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Watcher.node, FSUtil.node, Location.node, Git.node, Bus.node, Plugin.node, LocationWatcherPolicy.node],
})
