export * as Watcher from "./watcher"

// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import type ParcelWatcher from "@parcel/watcher"
import { makeLocationNode } from "../effect/app-node"
import { Cause, Context, Effect, Layer } from "effect"
import { FileSystemWatcher } from "@opencode-ai/schema/filesystem-watcher"
import path from "path"
import { Config } from "../config"
import { EventV2 } from "../event"
import { Flag } from "../flag/flag"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Location } from "../location"
import { lazy } from "../util/lazy"
import { Ignore } from "./ignore"
import { Protected } from "./protected"
import type { ProbeFailure } from "./watcher-inotify"

declare const OPENCODE_LIBC: string | undefined

const SUBSCRIBE_TIMEOUT_MS = 10_000

export const Event = FileSystemWatcher.Event

const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
  try {
    const libc = typeof OPENCODE_LIBC === "undefined" ? undefined : OPENCODE_LIBC
    const binding = require(
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

function protecteds(dir: string) {
  return Protected.paths().filter((item) => {
    const relative = path.relative(dir, item)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
}

export const hasNativeBinding = () => !!watcher()

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileWatcher") {}

export interface LayerOptions {
  readonly backend?: ReturnType<typeof getBackend>
  readonly watcher?: () => Pick<typeof import("@parcel/watcher"), "subscribe"> | undefined
  readonly probe?: () => ProbeFailure | undefined
}

// Loaded only on the inotify branch: the helper depends on bun:ffi, so a
// runtime without it keeps the pre-existing behaviour rather than losing file
// watching altogether.
const loadProbe = Effect.promise(() => import("./watcher-inotify")).pipe(
  Effect.map((module) => module.probe),
  Effect.catchCause(() => Effect.succeed(undefined)),
)

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      if (yield* Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return Service.of({})

      const backend = options?.backend ?? getBackend()
      const location = yield* Location.Service
      if (!backend) {
        yield* Effect.logError("watcher backend not supported", {
          directory: location.directory,
          platform: process.platform,
        })
        return Service.of({})
      }

      const w = (options?.watcher ?? watcher)()
      if (!w) return Service.of({})

      const probe = options?.probe ?? (backend === "inotify" ? yield* loadProbe : undefined)

      yield* Effect.logInfo("watcher backend", { directory: location.directory, platform: process.platform, backend })
      const events = yield* EventV2.Service
      const fs = yield* FSUtil.Service
      const git = yield* Git.Service
      const context = yield* Effect.context()
      const runFork = Effect.runForkWith(context)
      const subscriptions: ParcelWatcher.AsyncSubscription[] = []
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => Promise.allSettled(subscriptions.map((subscription) => subscription.unsubscribe()))),
      )

      const callback: ParcelWatcher.SubscribeCallback = (_error, updates) => {
        for (const update of updates) {
          if (update.type === "create") runFork(events.publish(Event.Updated, { file: update.path, event: "add" }))
          if (update.type === "update") runFork(events.publish(Event.Updated, { file: update.path, event: "change" }))
          if (update.type === "delete") runFork(events.publish(Event.Updated, { file: update.path, event: "unlink" }))
        }
      }

      const subscribe = (directory: string, ignore: string[]) =>
        Effect.gen(function* () {
          const started = yield* Effect.sync(() => {
            const failure = probe?.()
            if (failure) return { type: "unavailable" as const, failure }
            // Nothing may run between the probe and this call. subscribe()
            // reaches the native backend synchronously on the calling thread,
            // and a kernel that refuses an inotify instance there parks that
            // thread forever instead of failing, so the window in which another
            // process can take the last instance stays one expression wide.
            return { type: "started" as const, pending: w.subscribe(directory, callback, { ignore, backend }) }
          })

          if (started.type === "unavailable") {
            yield* Effect.logWarning("watcher unavailable, continuing without it", {
              directory,
              backend,
              errno: started.failure.errno,
              code: started.failure.code,
            })
            return false
          }

          yield* Effect.forkScoped(
            Effect.promise(() => started.pending).pipe(
              Effect.tap((subscription) => Effect.sync(() => subscriptions.push(subscription))),
              Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
              Effect.catchCause((cause) => {
                started.pending.then((subscription) => subscription.unsubscribe()).catch(() => {})
                return Effect.logError("failed to subscribe", { directory, cause: Cause.pretty(cause) })
              }),
            ),
          )
          return true
        })

      const config = (yield* (yield* Config.Service).entries())
        .filter((entry): entry is Config.Document => entry.type === "document")
        .flatMap((item) => item.info.watcher?.ignore ?? [])
      if (location.vcs && (yield* Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER)) {
        const subscribed = yield* subscribe(location.directory, [
          ...Ignore.PATTERNS,
          ...config,
          ...protecteds(location.directory),
        ])
        // The .git watcher below would ask the same exhausted kernel for the
        // same resource, so there is nothing left to try.
        if (!subscribed) return Service.of({})
      }

      if (location.vcs?.type === "git") {
        const resolved = (yield* git.repo.discover(location.directory))?.gitDirectory
        const vcs = resolved
          ? yield* fs.realPath(resolved).pipe(Effect.catch(() => Effect.succeed(resolved)))
          : undefined
        if (vcs && !config.includes(".git") && !config.includes(vcs) && (!resolved || !config.includes(resolved))) {
          const ignore = (yield* fs.readDirectoryEntries(vcs).pipe(Effect.catch(() => Effect.succeed([])))).flatMap(
            (entry) => (entry.name === "HEAD" ? [] : [entry.name]),
          )
          yield* subscribe(vcs, ignore)
        }
      }

      return Service.of({})
    }).pipe(
      Effect.catchCause((cause) => {
        return Effect.logError("failed to init watcher service", { cause: Cause.pretty(cause) }).pipe(
          Effect.as(Service.of({})),
        )
      }),
    ),
  )

export const nodeWith = (options?: LayerOptions) =>
  makeLocationNode({
    service: Service,
    layer: layerWith(options),
    deps: [FSUtil.node, Location.node, Config.node, Git.node, EventV2.node],
  })

export const node = nodeWith()
