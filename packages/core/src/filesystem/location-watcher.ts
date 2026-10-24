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
import { Ignore } from "./ignore.js"
import { LocationWatcherPolicy } from "./location-watcher-policy.js"
import { Protected } from "./protected.js"
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
    const active = new Map<string, { input: Watcher.WatchInput; scope: Scope.Closeable }>()

    const start = (key: string, input: Watcher.WatchInput) =>
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        active.set(key, { input, scope })
        yield* Effect.gen(function* () {
          const updates = yield* watcher.subscribe(input)
          yield* Stream.runForEach(updates, publish)
        }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.logError("location watcher subscription failed", { path: input.path, cause }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

    const stop = (key: string) =>
      Effect.gen(function* () {
        const entry = active.get(key)
        if (!entry) return
        active.delete(key)
        yield* Scope.close(entry.scope, Exit.void)
      })

    const reconcile = () =>
      lock.withPermit(
        Effect.gen(function* () {
          if (stopped) return
          const resolved = yield* target
          const ignore = policy.current()
          // Workspace files: edits under the location are published so clients can
          // refresh open views. VCS metadata is excluded: store churn is not an
          // edit, and the exact branch-metadata subscription below covers switches.
          const inputs = new Map<string, Watcher.WatchInput>()
          // A workspace rooted at the home directory or the filesystem root would
          // recursively watch everything under it. Only branch metadata is watched
          // there; the policy remains available for narrower explicit watches.
          const oversized = Protected.isHome(location.directory)
            ? "home directory"
            : location.directory === path.parse(location.directory).root
              ? "filesystem root"
              : undefined
          if (oversized) {
            yield* Effect.logWarning("workspace directory watch skipped", {
              directory: location.directory,
              reason: oversized,
            })
          } else {
            const directory: Watcher.WatchInput = {
              path: location.directory,
              type: "directory",
              ignore: [...new Set([...ignore, ...Ignore.PATTERNS])].toSorted(),
            }
            inputs.set(JSON.stringify(directory), directory)
          }
          const vcs =
            resolved && !resolved.aliases.some((alias) => ignore.includes(alias))
              ? { path: resolved.path, type: "file" as const }
              : undefined
          if (vcs) inputs.set(JSON.stringify(vcs), vcs)
          for (const key of Array.from(active.keys())) {
            if (inputs.has(key)) continue
            yield* stop(key)
          }
          for (const [key, input] of inputs) {
            if (active.has(key)) continue
            yield* start(key, input)
          }
        }).pipe(Effect.withSpan("LocationWatcher.reconcile", { attributes: { directory: location.directory } })),
      )
    yield* Effect.addFinalizer(() =>
      lock.withPermit(
        Effect.gen(function* () {
          stopped = true
          for (const key of Array.from(active.keys())) yield* stop(key)
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
