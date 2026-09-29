export * as ConfigResources from "./resources"

import { createHash } from "node:crypto"
import path from "node:path"
import { Cause, Context, Effect, Exit, Layer, Queue, Schema, Scope, Semaphore, Stream } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Glob } from "@opencode-ai/core/util/glob"
import { FileSystemWatcher } from "@opencode-ai/schema/filesystem-watcher"
import { ConfigResourceEvent } from "@opencode-ai/schema/config-resource-event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { isRecord } from "@/util/record"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"

export type Source = { file: string } | { directory: string; pattern: string }

export type Resource<A> = {
  readonly pin?: boolean
  load(instance: InstanceContext, previous?: A): Effect.Effect<A, never, Scope.Scope>
}

type Snapshot = {
  directory: string
  revision: number
  values: Map<Resource<unknown>, Effect.Effect<unknown>>
  sources: Map<Resource<unknown>, Source[]>
  restartRequired: Map<Resource<unknown>, string[]>
}

const Current = Context.Reference<Snapshot | undefined>("ConfigResources.Current", { defaultValue: () => undefined })
const Pinned = Context.Reference<Snapshot | undefined>("ConfigResources.Pinned", { defaultValue: () => undefined })
const Loading = Context.Reference<Resource<unknown> | undefined>("ConfigResources.Loading", {
  defaultValue: () => undefined,
})

export const make = <A>(load: Resource<A>["load"], options?: { pin?: boolean }): Resource<A> => ({ load, ...options })

export interface Interface {
  readonly get: <A>(resource: Resource<A>, options?: { fresh?: boolean }) => Effect.Effect<A>
  readonly watch: (sources: Source[]) => Effect.Effect<void>
  readonly requireRestart: (fields: string[]) => Effect.Effect<void>
  readonly withSnapshot: <A, E, R>(
    resource: Resource<unknown>,
    effect: Effect.Effect<A, E, R>,
    options?: { fresh?: boolean },
  ) => Effect.Effect<A, E, R>
}

export class ReloadError extends Schema.TaggedErrorClass<ReloadError>()("ConfigReloadError", {
  message: Schema.String,
}) {}

function errorMessage(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  // Parser errors can contain whole configuration documents, including secrets.
  // The catalog notification identifies the source without broadcasting its text.
  if (isRecord(error) && isRecord(error.data) && typeof error.data.path === "string") {
    return `${error.data.path}: ${typeof error.name === "string" ? error.name : "Invalid configuration"}`
  }
  if (isRecord(error) && typeof error.path === "string") return `${error.path}: Invalid configuration`
  return error instanceof Error ? error.message : "Failed to reload workspace configuration"
}

function matches(source: Source, file: string) {
  if ("file" in source) return source.file === file || source.file.startsWith(file + path.sep)
  if (source.directory === file || source.directory.startsWith(file + path.sep)) return true
  const relative = path.relative(source.directory, file).split(path.sep).join("/")
  if (relative.startsWith("../") || path.isAbsolute(relative)) return false
  return [relative, `${relative}/SKILL.md`, `${relative}/entry.md`].some((name) => Glob.match(source.pattern, name))
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConfigResources") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service

    const fingerprint = Effect.fn("ConfigResources.fingerprint")(function* (snapshot: Snapshot) {
      const sources = Array.from(snapshot.sources.values()).flat()
      const files = yield* Effect.forEach(
        sources,
        (source) =>
          "file" in source
            ? Effect.succeed([source.file])
            : fs.glob(source.pattern, { cwd: source.directory, absolute: true, dot: true, symlink: true }),
        { concurrency: 8 },
      )
      const entries = yield* Effect.forEach(
        Array.from(new Set(files.flat())).sort(),
        (file) =>
          fs.readFileString(file).pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
            Effect.map((text) => [file, text]),
          ),
        { concurrency: 8 },
      )
      return createHash("sha256").update(JSON.stringify(entries)).digest("hex")
    }, Effect.orDie)

    const state = yield* InstanceState.make(
      Effect.fn("ConfigResources.state")(function* (instance) {
        const scope = yield* Scope.Scope
        const lock = Semaphore.makeUnsafe(1)
        const changes = yield* Queue.unbounded<Schema.Schema.Type<typeof ConfigResourceEvent.Event.Updated.data>>()
        yield* Effect.addFinalizer(() => Queue.shutdown(changes))
        yield* Stream.fromQueue(changes).pipe(
          Stream.runForEach((change) =>
            events
              .publish(ConfigResourceEvent.Event.Updated, change)
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("configuration notification failed", { message: errorMessage(cause) }),
                ),
              ),
          ),
          Effect.forkScoped,
        )
        const state: { snapshot?: Snapshot; fingerprint?: string } = {}
        const valid = new Map<Resource<unknown>, unknown>()

        const read = Effect.fnUntraced(function* <A>(snapshot: Snapshot, resource: Resource<A>, previous?: Snapshot) {
          const found = snapshot.values.get(resource)
          if (found) return (yield* found) as A
          const before = previous?.values.get(resource)
          const cached = yield* Effect.cached(
            Effect.gen(function* () {
              const old = before ? yield* Effect.exit(before) : undefined
              snapshot.sources.delete(resource)
              snapshot.restartRequired.delete(resource)
              return yield* resource.load(
                instance,
                old && Exit.isSuccess(old) ? (old.value as A) : (valid.get(resource) as A | undefined),
              )
            }).pipe(
              Effect.provideService(Current, snapshot),
              Effect.provideService(Loading, resource),
              Effect.provideService(Scope.Scope, scope),
            ),
          )
          snapshot.values.set(resource, cached)
          return yield* cached
        })

        const fresh = Effect.fnUntraced(function* (resource?: Resource<unknown>) {
          const previous = state.snapshot
          const before = previous ? yield* fingerprint(previous) : undefined
          if (previous && (!resource || previous.values.has(resource)) && before === state.fingerprint) return previous

          const roots = Array.from(new Set([...(previous?.values.keys() ?? []), ...(resource ? [resource] : [])]))
          // A save can arrive while loaders are reading. Publish only after two
          // inventories agree; old objects remain usable by in-flight work.
          const rebuild = (expected: string | undefined): Effect.Effect<Snapshot> =>
            Effect.gen(function* () {
              const candidate: Snapshot = {
                directory: instance.directory,
                revision: (previous?.revision ?? 0) + (previous && expected !== state.fingerprint ? 1 : 0),
                values: new Map(),
                sources: new Map(previous?.sources),
                restartRequired: new Map(previous?.restartRequired),
              }
              yield* Effect.forEach(roots, (root) => read(candidate, root, previous).pipe(Effect.exit), {
                concurrency: 1,
              })
              const after = yield* fingerprint(candidate)
              if (expected !== after) return yield* rebuild(after)
              const settled = yield* Effect.forEach(candidate.values, ([resource, value]) =>
                Effect.exit(value).pipe(Effect.map((result) => [resource, result] as const)),
              )
              const errors = Array.from(
                new Set(settled.flatMap(([, result]) => (Exit.isFailure(result) ? [errorMessage(result.cause)] : []))),
              )
              yield* Effect.gen(function* () {
                // Drop loader closures so successive revisions don't retain every
                // previous snapshot. Active invocations retain only their own one.
                for (const [resource, result] of settled) {
                  candidate.values.set(resource, result)
                  if (Exit.isSuccess(result)) valid.set(resource, result.value)
                }
                state.snapshot = candidate
                state.fingerprint = after
                if (previous && candidate.revision !== previous.revision) {
                  yield* Queue.offer(changes, {
                    revision: candidate.revision,
                    status: errors.length ? "error" : "ready",
                    ...(errors.length ? { error: errors.join("\n") } : {}),
                    restartRequired: Array.from(new Set(Array.from(candidate.restartRequired.values()).flat())).sort(),
                  })
                }
              }).pipe(Effect.uninterruptible)
              return candidate
            })
          return yield* rebuild(before)
        })

        const dirty = yield* Queue.unbounded<void>()
        // Register before returning the instance state. Starting a stream fiber
        // alone doesn't guarantee that its upstream subscription is ready.
        const unsubscribe = yield* events.listen((event) => {
          if (
            event.type !== FileSystemWatcher.Event.Updated.type ||
            !Schema.is(FileSystemWatcher.Event.Updated)(event)
          ) {
            return Effect.void
          }
          if (
            !Array.from(state.snapshot?.sources.values() ?? [])
              .flat()
              .some((source) => matches(source, event.data.file))
          ) {
            return Effect.void
          }
          return Queue.offer(dirty, undefined).pipe(Effect.asVoid)
        })
        yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(dirty))))
        yield* Stream.fromQueue(dirty).pipe(
          Stream.debounce("75 millis"),
          Stream.runForEach(() =>
            lock
              .withPermits(1)(fresh())
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("configuration refresh failed", { message: errorMessage(cause) }),
                ),
              ),
          ),
          Effect.forkScoped,
        )

        return {
          get: <A>(resource: Resource<A>, options?: { fresh?: boolean }) =>
            Effect.gen(function* () {
              const current = yield* Current
              if (current?.directory === instance.directory) return yield* read(current, resource, state.snapshot)
              const pinned = yield* Pinned
              if (!options?.fresh && resource.pin && pinned?.directory === instance.directory)
                return yield* read(pinned, resource)
              const snapshot = yield* lock.withPermits(1)(fresh(resource))
              return yield* read(snapshot, resource).pipe(
                Effect.catchCause((cause) =>
                  snapshot.revision > 0
                    ? Effect.die(new ReloadError({ message: errorMessage(cause) }))
                    : Effect.failCause(cause),
                ),
              )
            }),
          withSnapshot: <A, E, R>(
            resource: Resource<unknown>,
            effect: Effect.Effect<A, E, R>,
            options?: { fresh?: boolean },
          ) =>
            Effect.gen(function* () {
              const pinned = yield* Pinned
              if (!options?.fresh && pinned?.directory === instance.directory) return yield* effect
              // Task dispatch requests a fresh revision even inside a running parent.
              const snapshot = yield* lock.withPermits(1)(fresh(resource))
              yield* read(snapshot, resource).pipe(
                Effect.catchCause((cause) => Effect.die(new ReloadError({ message: errorMessage(cause) }))),
              )
              return yield* effect.pipe(Effect.provideService(Pinned, snapshot))
            }),
        }
      }),
    )

    return Service.of({
      get: (resource, options) => InstanceState.useEffect(state, (state) => state.get(resource, options)),
      withSnapshot: (resource, effect, options) =>
        InstanceState.useEffect(state, (state) => state.withSnapshot(resource, effect, options)),
      requireRestart: Effect.fn("ConfigResources.requireRestart")(function* (fields) {
        const snapshot = yield* Current
        const resource = yield* Loading
        if (!snapshot || !resource) return yield* Effect.die(new Error("Reload requirements must belong to a resource"))
        snapshot.restartRequired.set(resource, fields)
      }),
      watch: Effect.fn("ConfigResources.watch")(function* (sources) {
        const snapshot = yield* Current
        const resource = yield* Loading
        // The global config API can also parse files outside a workspace revision.
        if (!snapshot || !resource) return
        snapshot.sources.set(resource, [...(snapshot.sources.get(resource) ?? []), ...sources])
      }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, EventV2Bridge.node] })
