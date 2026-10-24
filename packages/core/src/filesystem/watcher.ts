export * as Watcher from "./watcher.js"

// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper.js"
import type ParcelWatcher from "@parcel/watcher"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Cause, Context, Deferred, Duration, Effect, Layer, PubSub, RcMap, Stream } from "effect"
import { lazy } from "../util/lazy.js"
import { watch } from "node:fs"
import path from "path"
import loadBinding from "./watcher-binding.js"

const SUBSCRIBE_TIMEOUT_MS = 10_000

// Callers resubscribe on provider reloads: they release their stream and acquire a
// new one milliseconds later. Without a grace period each blip closes the native
// subscription and opens a new one, and the native addon panics when that stop/start
// churn repeats (parcel-bundler/watcher on Windows). The keeper below holds an extra
// reference for this window after the last consumer leaves, so a quick resubscribe
// reuses the live subscription instead of restarting it.
const IDLE_TIME_TO_LIVE = Duration.seconds(2)

const watcher = lazy((): typeof ParcelWatcher | undefined => {
  try {
    return createWrapper(loadBinding()) as typeof ParcelWatcher
  } catch {
    return
  }
})

function getBackend() {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "fs-events"
  if (process.platform === "linux") return "inotify"
}

export const hasNativeBinding = () => !!watcher()
export type Update = ParcelWatcher.Event

export type WatchInput =
  | { readonly path: string; readonly type: "file" }
  | { readonly path: string; readonly type: "entries"; readonly names: readonly string[] }
  | { readonly path: string; readonly type: "directory"; readonly ignore?: readonly string[] }

type Subscription = {
  readonly unsubscribe: () => Promise<void>
  /** Backend name for logging, e.g. "node" or "fs-events". */
  readonly backend?: string
}

type Target = {
  readonly target: string
  readonly ignore: readonly string[]
} & (
  | { readonly type: "entries"; readonly names: readonly string[] }
  | { readonly type: "file" | "directory"; readonly names?: readonly string[] }
)

export interface NativeInterface {
  readonly subscribe: (
    input: Target & { readonly publish: (update: Update) => void },
  ) => Effect.Effect<Subscription | undefined>
}

/** Uses fs.watch for immediate entries and Parcel for recursive directories. */
export class Native extends Context.Service<Native, NativeInterface>()("@opencode/Watcher/Native") {}

export interface Interface {
  /** onReady runs after native acquisition and listener registration, when the stream is consumed. */
  readonly subscribe: (input: WatchInput, onReady?: Effect.Effect<void>) => Effect.Effect<Stream.Stream<Update>>
}

export interface Options {
  readonly enabled?: boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Watcher") {}

interface TestInterface extends Interface {
  /** Delivers one update to every active watch whose target covers `update.path`. */
  readonly emit: (update: Update) => Effect.Effect<void>
  /** Returns every subscribe call observed so far, in order. */
  readonly subscriptions: () => Effect.Effect<readonly WatchInput[]>
}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/Watcher/Test") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      if (options?.enabled === false) {
        return Service.of({ subscribe: () => Effect.succeed(Stream.empty) })
      }
      const native = yield* Native
      const scope = yield* Effect.scope

      // Keys compare structurally (effect Equal), so equivalent watches share one entry.
      const watchers = yield* RcMap.make({
        lookup: (key: Target) =>
          Effect.gen(function* () {
            const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<Update>(), (pubsub) => PubSub.shutdown(pubsub))
            const subscription = yield* Effect.acquireRelease(
              native.subscribe({
                ...key,
                publish: (update) => PubSub.publishUnsafe(pubsub, update),
              }),
              (subscription) =>
                subscription
                  ? Effect.promise(() => subscription.unsubscribe()).pipe(
                      Effect.ignoreCause,
                      Effect.andThen(Effect.logInfo("watcher stopped", { path: key.target, type: key.type })),
                    )
                  : Effect.void,
              // Native subscription may stay pending up to SUBSCRIBE_TIMEOUT_MS;
              // scope shutdown must not wait behind an uninterruptible acquisition.
              { interruptible: true },
            )
            if (!subscription) {
              // Unsupported backend: end subscriber streams instead of hanging them.
              yield* PubSub.shutdown(pubsub)
              return pubsub
            }
            yield* Effect.logInfo("watcher started", {
              path: key.target,
              type: key.type,
              backend: subscription.backend,
              ignores: key.ignore.length,
            })
            return pubsub
          }),
      })

      // Holds a second reference to an acquired watch until the consumer leaves plus
      // the grace window, so resubscribe churn never restarts the native watcher.
      // `getOption` retains an existing entry instead of starting a lookup: the
      // consumer still owns the acquisition, so interrupting it cancels a pending
      // native subscribe rather than waiting out the grace window. The explicit
      // `scoped` keeps the retained reference alive past the consumer's scope,
      // which a bare `forkIn` fiber would inherit.
      const keepWarm = (key: Target, released: Deferred.Deferred<void>, held: Deferred.Deferred<void>) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* RcMap.getOption(watchers, key).pipe(Effect.onExit(() => Deferred.succeed(held, undefined)))
            yield* Deferred.await(released)
            yield* Effect.sleep(IDLE_TIME_TO_LIVE)
          }),
        ).pipe(Effect.ignoreCause, Effect.forkIn(scope), Effect.asVoid)

      const subscribe = Effect.fnUntraced(function* (input: WatchInput, onReady: Effect.Effect<void> = Effect.void) {
        const target = path.resolve(input.path)
        const ignore = [...new Set(input.type === "directory" ? (input.ignore ?? []) : [])].toSorted()
        const names = [...new Set(input.type === "entries" ? input.names : [])].toSorted()
        yield* Effect.logInfo("watcher subscribe", {
          path: target,
          type: input.type,
          ignores: ignore.length,
        })
        return Stream.unwrap(
          Effect.gen(function* () {
            const key = { type: input.type, target, ignore, names }
            const pubsub = yield* RcMap.get(watchers, key)
            const released = yield* Deferred.make<void>()
            const held = yield* Deferred.make<void>()
            yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined))
            yield* keepWarm(key, released, held)
            yield* Deferred.await(held)
            const subscription = yield* PubSub.subscribe(pubsub)
            if (yield* PubSub.isShutdown(pubsub)) return Stream.empty
            yield* onReady
            return Stream.fromSubscription(subscription)
          }),
        )
      })

      return Service.of({ subscribe })
    }),
  )

/** Real subscription lifecycle with in-memory, path-filtered event delivery. */
export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const subscriptions: WatchInput[] = []
    const active = new Map<(update: Update) => void, (path: string) => boolean>()
    const native = Native.of({
      subscribe: (input) =>
        Effect.sync(() => {
          subscriptions.push(
            input.type === "file"
              ? { path: input.target, type: "file" }
              : input.type === "entries"
                ? { path: input.target, type: "entries", names: input.names }
                : input.ignore.length > 0
                  ? { path: input.target, type: "directory", ignore: input.ignore }
                  : { path: input.target, type: "directory" },
          )
          // Ignore entries resolve against the target like the parcel wrapper's
          // literal paths. Glob entries resolve to paths nothing lives under, so
          // they are inert here rather than compiled the way parcel compiles them.
          const ignored = input.ignore.map((entry) => path.resolve(input.target, entry))
          active.set(input.publish, (target) => {
            if (input.type === "file") return target === input.target
            if (input.type === "entries")
              return path.dirname(target) === input.target && input.names.includes(path.basename(target))
            return FSUtil.contains(input.target, target) && !ignored.some((entry) => FSUtil.contains(entry, target))
          })
          return {
            unsubscribe: () => {
              active.delete(input.publish)
              return Promise.resolve()
            },
          }
        }),
    })
    const context = yield* Layer.build(layer().pipe(Layer.provide(Layer.succeed(Native, native))))
    const test = Test.of({
      subscribe: Context.get(context, Service).subscribe,
      emit: (update) =>
        Effect.sync(() => {
          const target = path.resolve(update.path)
          active.forEach((matches, publish) => {
            if (matches(target)) publish(update)
          })
        }),
      subscriptions: () => Effect.sync(() => [...subscriptions]),
    })
    return Context.empty().pipe(Context.add(Service, test), Context.add(Test, test))
  }),
)

export const nativeLayer = Layer.succeed(
  Native,
  Native.of({
    subscribe: (input) => {
      if (input.type === "file" || input.type === "entries") {
        return Effect.sync(() => {
          const directory = input.type === "file" ? path.dirname(input.target) : input.target
          const names = new Set(input.type === "file" ? [path.basename(input.target)] : input.names)
          const subscription = watch(directory, { recursive: false }, (_event, file) => {
            if (file && !names.has(file)) return
            for (const name of file ? [file] : names) {
              input.publish({ path: path.join(directory, name), type: "update" })
            }
          })
          subscription.on("error", (error: unknown) =>
            Effect.runFork(Effect.logError("watcher callback failed", { path: directory, error })),
          )
          return { unsubscribe: () => Promise.resolve(subscription.close()), backend: "node" }
        })
      }
      return subscribeDirectory(watcher(), getBackend(), input.target, input.ignore, input.publish)
    },
  }),
)

const nativeNode = makeGlobalNode({ service: Native, layer: nativeLayer, deps: [] })

export function configured(options?: Options) {
  return makeGlobalNode({ service: Service, layer: layer(options), deps: [nativeNode] })
}

export const node = configured()

function subscribeDirectory(
  native: typeof ParcelWatcher | undefined,
  backend: ParcelWatcher.BackendType | undefined,
  directory: string,
  ignore: readonly string[],
  publish: (update: Update) => void,
): Effect.Effect<Subscription | undefined> {
  if (!native || !backend) {
    return Effect.logError("watcher backend not supported", { directory, platform: process.platform }).pipe(
      Effect.as(undefined),
    )
  }
  const callback: ParcelWatcher.SubscribeCallback = (error, updates) => {
    if (error) Effect.runFork(Effect.logError("watcher callback failed", { error }))
    for (const update of updates) publish(update)
  }
  // Copy `ignore`: it aliases the RcMap key, whose structural hash is cached,
  // so the array handed to native code must never be the mutable original.
  const pending = native.subscribe(directory, callback, { ignore: [...ignore], backend })
  return Effect.promise(() => pending).pipe(
    Effect.map((subscription) => ({ unsubscribe: () => subscription.unsubscribe(), backend })),
    // Interruption (including the timeout below) abandons the pending native
    // subscription, so close it once it eventually resolves.
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        pending.then((subscription) => subscription.unsubscribe()).catch(() => {})
      }),
    ),
    Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
    Effect.catchCause((cause) =>
      Effect.logError("failed to subscribe", {
        directory,
        cause: Cause.pretty(cause),
      }).pipe(Effect.as(undefined)),
    ),
  )
}
