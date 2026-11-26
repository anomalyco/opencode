export * as LocationWatcher from "./location-watcher.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Cause, Context, Effect, Exit, Layer, Scope, Semaphore, Stream } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import path from "path"
import { Bus } from "../bus.js"
import { FSUtil } from "@opencode/util/fs-util"
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
    const scope = yield* Scope.Scope
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
    const realPath = (target: string) => fs.realPath(target).pipe(Effect.orElseSucceed(() => target))
    const repository = yield* Effect.cached(
      Effect.gen(function* () {
        if (location.vcs?.type === "git") {
          const discovered = yield* git.repo.discover(location.directory)
          const resolved = discovered?.gitDirectory
          const vcs = resolved ? yield* realPath(resolved) : undefined
          if (vcs && discovered) {
            const common = yield* realPath(discovered.commonDirectory)
            return {
              head: path.join(vcs, "HEAD"),
              common,
              aliases: [".git", vcs, common, ...(resolved ? [resolved] : [])],
            }
          }
        }
        if (location.vcs?.type === "hg") {
          const store = location.vcs.store
          const vcs = yield* realPath(store)
          return { head: path.join(vcs, "branch"), common: undefined, aliases: [".hg", vcs] }
        }
      }).pipe(
        Effect.withSpan("LocationWatcher.repository", { attributes: { directory: location.directory } }),
        Effect.catchCause((cause) =>
          Effect.logError("failed to resolve location watcher target", { cause }).pipe(Effect.as(undefined)),
        ),
      ),
    )
    // HEAD changes on a branch switch only. A commit, merge or reset rewrites the branch ref it points at
    // instead, which a detached HEAD does not have.
    const target = Effect.gen(function* () {
      const found = yield* repository
      if (!found) return
      const paths = [found.head]
      if (found.common) {
        const head = yield* fs.readFileStringSafe(found.head).pipe(Effect.orElseSucceed(() => undefined))
        const name = head?.match(/^ref:\s*(refs\/heads\/\S+)/)?.[1]
        const branch = name && path.join(found.common, name)
        if (branch && FSUtil.contains(found.common, branch)) paths.push(branch)
      }
      return { paths, aliases: found.aliases, follows: !!found.common }
    })
    const lock = Semaphore.makeUnsafe(1)
    let stopped = false
    const active = new Map<string, Scope.Closeable>()
    const reconcile = (): Effect.Effect<void> =>
      lock.withPermit(
        Effect.gen(function* () {
          if (stopped) return
          const resolved = yield* target
          const next =
            resolved && !resolved.aliases.some((alias) => policy.current().includes(alias)) ? resolved.paths : []
          yield* Effect.forEach(
            [...active].filter(([path]) => !next.includes(path)),
            ([path, owned]) =>
              Effect.andThen(
                Effect.sync(() => active.delete(path)),
                Scope.close(owned, Exit.void),
              ),
          )
          yield* Effect.forEach(
            next.flatMap((path, index) =>
              active.has(path) ? [] : [{ path, head: index === 0 && !!resolved?.follows }],
            ),
            (watch) =>
              Effect.gen(function* () {
                const owned = yield* Scope.make()
                active.set(watch.path, owned)
                yield* Effect.gen(function* () {
                  // HEAD may move while its watch is acquired and names another ref after a switch;
                  // re-resolve from outside this scope, which the re-resolve may close.
                  const updates = yield* watcher.subscribe(
                    { path: watch.path, type: "file" },
                    watch.head ? reconcileLater : undefined,
                  )
                  yield* Stream.runForEach(updates, (update) =>
                    publish(update).pipe(Effect.andThen(watch.head ? reconcileLater : Effect.void)),
                  )
                }).pipe(
                  Effect.catchCauseIf(
                    (cause) => !Cause.hasInterrupts(cause),
                    (cause) => Effect.logError("location watcher subscription failed", { path: watch.path, cause }),
                  ),
                  Effect.forkIn(owned, { startImmediately: true }),
                )
              }),
          )
        }).pipe(Effect.withSpan("LocationWatcher.reconcile", { attributes: { directory: location.directory } })),
      )
    const reconcileLater = reconcile().pipe(Effect.forkIn(scope), Effect.asVoid)
    yield* Effect.addFinalizer(() =>
      lock.withPermit(
        Effect.gen(function* () {
          stopped = true
          yield* Effect.forEach(active.values(), (owned) => Scope.close(owned, Exit.void))
          active.clear()
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
