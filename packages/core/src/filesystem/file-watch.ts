export * as FileWatch from "./file-watch.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { FileSystem } from "@opencode/schema/filesystem"
import type { Location } from "@opencode/schema/location"
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Schedule,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect"
import { Bus } from "../bus.js"
import { Watcher } from "./watcher.js"

export const TTL = Duration.hours(24)
export const SWEEP_INTERVAL = Duration.minutes(5)
export const MAX_PER_LOCATION = 256
/** Browsed directories re-arm on every listing, so their watches keep a shorter lease. */
export const CHILDREN_TTL = Duration.hours(1)
/** Directory watches take from their own budget so they never evict open-tab file watches. */
export const MAX_CHILDREN_PER_LOCATION = 64
/** Directory churn coalesces so clients re-list a browsed directory at most once per window. */
export const CHILDREN_COALESCE = Duration.millis(250)

export class DisabledError extends Schema.TaggedError<DisabledError>()("FileWatch.DisabledError", {}) {
  override get message() {
    return "File watching is disabled"
  }
}

export type Input = {
  readonly location: Location.Ref
  /** Absolute path of the file or directory to watch. */
  readonly file: string
  /** Watch a directory's immediate entries rather than one file. Defaults to "file". */
  readonly type?: "file" | "children"
}

export interface Interface {
  /** Starts watching a file, or resets its expiry when it is already watched. */
  readonly watch: (input: Input) => Effect.Effect<void, DisabledError>
  readonly unwatch: (input: Input) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileWatch") {}

export const Options = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

type Entry = { expires: number; type: "file" | "children"; scope: Scope.Closeable }

// Global rather than location-scoped so watches outlive idle location eviction.
export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      if (options?.enabled === false) {
        return Service.of({ watch: () => Effect.fail(new DisabledError()), unwatch: () => Effect.void })
      }
      const watcher = yield* Watcher.Service
      const bus = yield* Bus.Service
      const fs = yield* FSUtil.Service
      const scope = yield* Effect.scope
      const lock = yield* Semaphore.make(1)
      const locations = new Map<string, Map<string, Entry>>()
      const locationKey = (location: Location.Ref) => JSON.stringify([location.directory, location.workspaceID])

      const remove = (key: string, file: string) => {
        const files = locations.get(key)
        const entry = files?.get(file)
        if (!files || !entry) return
        files.delete(file)
        if (files.size === 0) locations.delete(key)
        return entry
      }

      const stop = (key: string, file: string) =>
        Effect.suspend(() => {
          const entry = remove(key, file)
          if (!entry) return Effect.void
          return Scope.close(entry.scope, Exit.void)
        })

      const start = Effect.fnUntraced(function* (key: string, input: Input) {
        const child = yield* Scope.fork(scope)
        yield* Effect.gen(function* () {
          const updates = yield* watcher.subscribe({ path: input.file, type: input.type ?? "file" })
          const publish = (event: "change" | "unlink") =>
            bus.publish(FileSystem.Event.Changed, { file: input.file, event }, { location: input.location })
          // Directory churn (a file written continuously, a burst of creates) coalesces so clients
          // re-list a browsed directory at most once per window, and the window's last update still
          // publishes once it ends. A removal ends the watch, so it always publishes immediately.
          let lastPublished = Number.NEGATIVE_INFINITY
          let pendingTrailing = false
          const flush = Effect.suspend(() => {
            pendingTrailing = false
            return Effect.gen(function* () {
              // The directory may be gone by the time the window ends; its removal event publishes the unlink.
              if (!(yield* fs.existsSafe(input.file))) return
              lastPublished = yield* Clock.currentTimeMillis
              yield* publish("change")
            })
          })
          yield* Stream.runForEachWhile(updates, () =>
            Effect.gen(function* () {
              const exists = yield* fs.existsSafe(input.file)
              if (!exists) {
                yield* publish("unlink")
                // A removed directory's native watch follows the old inode. A later listing must arm a new one.
                // A removed file keeps its watch so a recreated file resumes live reload.
                return input.type !== "children"
              }
              if (input.type !== "children") {
                yield* publish("change")
                return true
              }
              const now = yield* Clock.currentTimeMillis
              if (now - lastPublished >= Duration.toMillis(CHILDREN_COALESCE)) {
                lastPublished = now
                yield* publish("change")
                return true
              }
              if (!pendingTrailing) {
                pendingTrailing = true
                yield* Effect.sleep(Duration.toMillis(CHILDREN_COALESCE) - (now - lastPublished)).pipe(
                  Effect.andThen(flush),
                  Effect.forkIn(child, { startImmediately: true }),
                  Effect.asVoid,
                )
              }
              return true
            }),
          )
        }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.logError("file watch failed", { file: input.file, cause }),
          ),
          // The watch ended or failed (e.g. its directory vanished): forget it so the next watch starts a new one.
          // Interrupts skip this. The scope closes from another fiber because closing it interrupts this one.
          Effect.andThen(
            lock.withPermit(
              Effect.suspend(() => {
                if (locations.get(key)?.get(input.file)?.scope !== child) return Effect.void
                remove(key, input.file)
                return Scope.close(child, Exit.void).pipe(Effect.forkIn(scope), Effect.asVoid)
              }),
            ),
          ),
          Effect.forkIn(child, { startImmediately: true }),
        )
        return child
      })

      const sweep = lock.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const expired = [...locations].flatMap(([key, files]) =>
            [...files].filter(([, entry]) => entry.expires <= now).map(([file]) => [key, file] as const),
          )
          yield* Effect.forEach(expired, ([key, file]) => stop(key, file), { discard: true })
        }),
      )
      yield* sweep.pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)), Effect.forkScoped)

      return Service.of({
        watch: (input) =>
          lock.withPermit(
            Effect.gen(function* () {
              const key = locationKey(input.location)
              const type = input.type ?? "file"
              const ttl = type === "children" ? CHILDREN_TTL : TTL
              const expires = (yield* Clock.currentTimeMillis) + Duration.toMillis(ttl)
              const existing = locations.get(key)?.get(input.file)
              if (existing) {
                existing.expires = expires
                return
              }
              // Evict within the watch's own budget only, so a browsing session never
              // evicts the file watches behind open tabs, which would silently stop their live reload.
              const budget = type === "children" ? MAX_CHILDREN_PER_LOCATION : MAX_PER_LOCATION
              const sameType = [...(locations.get(key) ?? [])].filter(([, entry]) => entry.type === type)
              if (sameType.length >= budget) {
                const soonest = sameType.reduce((a, b) => (b[1].expires < a[1].expires ? b : a))
                yield* stop(key, soonest[0])
              }
              const entry = { expires, type, scope: yield* start(key, input) }
              const files = locations.get(key) ?? new Map<string, Entry>()
              files.set(input.file, entry)
              locations.set(key, files)
            }),
          ),
        unwatch: (input) => lock.withPermit(stop(locationKey(input.location), input.file)),
      })
    }),
  )

export function configured(options?: Options) {
  return makeGlobalNode({ service: Service, layer: layer(options), deps: [Watcher.node, Bus.node, FSUtil.node] })
}

export const node = configured()
