export * as Watcher from "./watcher"

// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import type ParcelWatcher from "@parcel/watcher"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { makeGlobalNode } from "../effect/app-node"
import { Cause, Context, Effect, Layer, PubSub, Scope, Stream } from "effect"
import { KeyedMutex } from "../effect/keyed-mutex"
import { Flag } from "../flag/flag"
import { lazy } from "../util/lazy"
import { watch as watchFileSystem } from "node:fs"
import path from "path"
import { createRequire } from "node:module"

declare const OPENCODE_LIBC: string | undefined

const SUBSCRIBE_TIMEOUT_MS = 10_000
const require = createRequire(import.meta.url)

export const Event = { Updated: FileSystem.Event.Changed }

const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
  try {
    const libc = typeof OPENCODE_LIBC === "undefined" ? undefined : OPENCODE_LIBC
    const binding = require(
      process.env.OPENCODE_PARCEL_WATCHER_PATH ??
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${libc || "glibc"}` : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
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
  | { readonly path: string; readonly type: "directory"; readonly ignore?: readonly string[] }

export interface Interface {
  readonly subscribe: (input: WatchInput) => Stream.Stream<Update>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Watcher") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const backend = getBackend()
    const native = watcher()
    if (Flag.OPENCODE_DISABLE_FILEWATCHER) {
      return Service.of({ subscribe: () => Stream.empty })
    }

    type Entry = {
      readonly pubsub: PubSub.PubSub<Update>
      readonly subscription: { readonly unsubscribe: () => Promise<void> }
      refs: number
    }
    const entries = new Map<string, Entry>()
    const locks = KeyedMutex.makeUnsafe<string>()

    const acquire = Effect.fn("Watcher.acquire")(function* (input: WatchInput) {
      const scope = yield* Scope.Scope
      const target = path.resolve(input.path)
      const directory = input.type === "file" ? path.dirname(target) : target
      const ignore = [...new Set(input.type === "directory" ? (input.ignore ?? []) : [])].toSorted()
      const id = JSON.stringify([input.type, target, ignore])
      const pubsub = yield* locks.withLock(id)(
        Effect.gen(function* () {
          const existing = entries.get(id)
          if (existing) {
            existing.refs++
            return existing.pubsub
          }
          const pubsub = yield* PubSub.unbounded<Update>()
          const subscription = yield* input.type === "file"
            ? Effect.sync(() => {
                const subscription = watchFileSystem(directory, { recursive: false }, (_event, file) => {
                  if (file && path.resolve(directory, file.toString()) !== target) return
                  PubSub.publishUnsafe(pubsub, {
                    path: target,
                    type: "update",
                  } satisfies Update)
                })
                if ("on" in subscription && typeof subscription.on === "function") {
                  subscription.on("error", (error: unknown) =>
                    Effect.runFork(Effect.logError("watcher callback failed", { path: target, error })),
                  )
                }
                return { unsubscribe: () => Promise.resolve(subscription.close()) }
              })
            : subscribeDirectory(native, backend, directory, ignore, pubsub)
          if (subscription) {
            entries.set(id, { pubsub, subscription, refs: 1 })
            yield* Effect.logInfo("watcher started", {
              path: target,
              type: input.type,
              backend: input.type === "file" ? "node" : backend,
              ignores: ignore.length,
            })
            return pubsub
          }
          yield* PubSub.shutdown(pubsub)
          return pubsub
        }),
      )

      yield* Scope.addFinalizer(
        scope,
        locks.withLock(id)(
          Effect.gen(function* () {
            const entry = entries.get(id)
            if (!entry) return
            entry.refs--
            if (entry.refs > 0) return
            entries.delete(id)
            yield* Effect.promise(() => entry.subscription.unsubscribe()).pipe(Effect.ignore)
            yield* PubSub.shutdown(entry.pubsub)
            yield* Effect.logInfo("watcher stopped", { path: target, type: input.type })
          }),
        ),
      )
      return pubsub
    })

    const subscribe = (input: WatchInput) =>
      Stream.unwrap(acquire(input).pipe(Effect.map((pubsub) => Stream.fromPubSub(pubsub))))

    return Service.of({ subscribe })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

function subscribeDirectory(
  native: typeof import("@parcel/watcher") | undefined,
  backend: ParcelWatcher.BackendType | undefined,
  directory: string,
  ignore: string[],
  pubsub: PubSub.PubSub<Update>,
) {
  if (!native || !backend) {
    return Effect.logError("watcher backend not supported", { directory, platform: process.platform }).pipe(
      Effect.as(undefined),
    )
  }
  const callback: ParcelWatcher.SubscribeCallback = (error, updates) => {
    if (error) Effect.runFork(Effect.logError("watcher callback failed", { error }))
    for (const update of updates) PubSub.publishUnsafe(pubsub, update)
  }
  const pending = native.subscribe(directory, callback, { ignore, backend })
  return Effect.promise(() => pending).pipe(
    Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
    Effect.catchCause((cause) => {
      pending.then((subscription) => subscription.unsubscribe()).catch(() => {})
      return Effect.logError("failed to subscribe", {
        directory,
        cause: Cause.pretty(cause),
      }).pipe(Effect.as(undefined))
    }),
  )
}
