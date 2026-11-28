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
    // instead, which a detached HEAD does not have. `git pack-refs` removes the folder of a nested branch
    // name once its ref is packed, so until that folder exists the entry below the nearest existing one is
    // watched, which is where the commit that recreates the folder shows up.
    const nearest = (entry: string, common: string): Effect.Effect<string | undefined> =>
      entry === common
        ? Effect.succeed(undefined)
        : fs
            .isDir(path.dirname(entry))
            .pipe(Effect.flatMap((exists) => (exists ? Effect.succeed(entry) : nearest(path.dirname(entry), common))))
    const target = Effect.gen(function* () {
      const found = yield* repository
      if (!found) return
      let ref: string | undefined
      let folder: string | undefined
      let present = false
      if (found.common) {
        const head = yield* fs.readFileStringSafe(found.head).pipe(Effect.orElseSucceed(() => undefined))
        const name = head?.match(/^ref:\s*(refs\/heads\/\S+)/)?.[1]
        const branch = name && path.join(found.common, name)
        if (branch && FSUtil.contains(found.common, branch)) {
          ref = branch
          present = yield* fs.isFile(branch)
          // The ref itself is watched as soon as its folder exists, as for any packed ref.
          const missing = present ? undefined : yield* nearest(branch, found.common)
          folder = missing === branch ? undefined : missing
        }
      }
      return { head: found.head, ref, folder, present, aliases: found.aliases, follows: !!found.common }
    })
    const lock = Semaphore.makeUnsafe(1)
    let stopped = false
    // The ref watched through its missing folder: the change that creates it is seen by no watch.
    let unseen: string | undefined
    const active = new Map<string, Scope.Closeable>()
    const reconcile = (): Effect.Effect<void> =>
      lock.withPermit(
        Effect.gen(function* () {
          if (stopped) return
          const resolved = yield* target
          const kept =
            resolved && !resolved.aliases.some((alias) => policy.current().includes(alias)) ? resolved : undefined
          const ref = kept?.ref
          const present = kept?.present ?? false
          const folder = kept?.folder
          // A ref that appeared while unseen was written without its event: report the change itself.
          if (ref && present && unseen === ref) yield* publish({ type: "update", path: ref })
          // Unseen is the ref watched through its missing folder, and stays so while it is still missing once
          // that folder exists; any other ref starts seen.
          unseen = folder ? ref : ref && !present && unseen === ref ? unseen : undefined
          const next = [
            ...(kept ? [{ path: kept.head, kind: "head" as const, reread: kept.follows }] : []),
            ...(ref
              ? [
                  {
                    path: folder ?? ref,
                    kind: folder ? ("folder" as const) : ("ref" as const),
                    reread: unseen === ref,
                  },
                ]
              : []),
          ]
          yield* Effect.forEach(
            [...active].filter(([path]) => !next.some((watch) => watch.path === path)),
            ([path, owned]) =>
              Effect.andThen(
                Effect.sync(() => active.delete(path)),
                Scope.close(owned, Exit.void),
              ),
          )
          yield* Effect.forEach(
            next.filter((watch) => !active.has(watch.path)),
            (watch) =>
              Effect.gen(function* () {
                const owned = yield* Scope.make()
                active.set(watch.path, owned)
                yield* Effect.gen(function* () {
                  // The target may change while its watch is acquired: HEAD may move to another ref after a
                  // switch, and the ref may appear while the watch for its missing folder is acquired.
                  // Re-resolve from outside this scope, which the re-resolve may close.
                  const updates = yield* watcher.subscribe(
                    { path: watch.path, type: "file" },
                    watch.reread ? reconcileLater : undefined,
                  )
                  yield* Stream.runForEach(updates, (update) =>
                    watch.kind === "ref"
                      ? // Its own watch saw this change, so none is unseen anymore.
                        Effect.sync(() => {
                          if (unseen === update.path) unseen = undefined
                        }).pipe(Effect.andThen(publish(update)))
                      : Effect.andThen(
                          // An entry watched in place of the ref is no change of the ref: only look again.
                          watch.kind === "folder" ? Effect.void : publish(update),
                          watch.reread ? reconcileLater : Effect.void,
                        ),
                  )
                }).pipe(
                  Effect.catchCauseIf(
                    (cause) => !Cause.hasInterrupts(cause),
                    (cause) => Effect.logError("location watcher subscription failed", { path: watch.path, cause }),
                  ),
                  // A subscription that ended delivers nothing more; the next reconcile acquires it again.
                  Effect.ensuring(
                    Effect.sync(() => {
                      if (active.get(watch.path) === owned) active.delete(watch.path)
                    }),
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
