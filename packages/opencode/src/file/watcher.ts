import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceContext } from "@/effect/instance-context"
import { Instance } from "@/project/instance"
import z from "zod"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import type ParcelWatcher from "@parcel/watcher"
import { readdir } from "fs/promises"
import { git } from "@/util/git"
import { Protected } from "./protected"
import { Flag } from "@/flag/flag"
import { Cause, Effect, Layer, ServiceMap } from "effect"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const OPENCODE_LIBC: string | undefined

const log = Log.create({ service: "file.watcher" })

const event = {
  Updated: BusEvent.define(
    "file.watcher.updated",
    z.object({
      file: z.string(),
      event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
    }),
  ),
}

const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
  try {
    const binding = require(
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCODE_LIBC || "glibc"}` : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
  } catch (error) {
    log.error("failed to load watcher binding", { error })
    return
  }
})

function getBackend() {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "fs-events"
  if (process.platform === "linux") return "inotify"
}

export namespace FileWatcher {
  export const Event = event
  /** Whether the native @parcel/watcher binding is available on this platform. */
  export const hasNativeBinding = () => !!watcher()
}

const init = Effect.fn("FileWatcherService.init")(function* () {})

export namespace FileWatcherService {
  export interface Service {
    readonly init: () => Effect.Effect<void>
  }
}

export class FileWatcherService extends ServiceMap.Service<FileWatcherService, FileWatcherService.Service>()(
  "@opencode/FileWatcher",
) {
  static readonly layer = Layer.effect(
    FileWatcherService,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      if (yield* Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return FileWatcherService.of({ init })

      log.info("init", { directory: instance.directory })

      const backend = getBackend()
      if (!backend) {
        log.error("watcher backend not supported", { directory: instance.directory, platform: process.platform })
        return FileWatcherService.of({ init })
      }

      const w = watcher()
      if (!w) return FileWatcherService.of({ init })

      log.info("watcher backend", { directory: instance.directory, platform: process.platform, backend })

      const subs: ParcelWatcher.AsyncSubscription[] = []
      yield* Effect.addFinalizer(() => Effect.promise(() => Promise.allSettled(subs.map((sub) => sub.unsubscribe()))))

      const cb: ParcelWatcher.SubscribeCallback = Instance.bind((err, evts) => {
        if (err) return
        for (const evt of evts) {
          if (evt.type === "create") Bus.publish(event.Updated, { file: evt.path, event: "add" })
          if (evt.type === "update") Bus.publish(event.Updated, { file: evt.path, event: "change" })
          if (evt.type === "delete") Bus.publish(event.Updated, { file: evt.path, event: "unlink" })
        }
      })

      const subscribe = (dir: string, ignore: string[]) => {
        const pending = w.subscribe(dir, cb, { ignore, backend })
        return Effect.gen(function* () {
          const sub = yield* Effect.promise(() => pending)
          subs.push(sub)
        }).pipe(
          Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
          Effect.catchCause((cause) => {
            log.error("failed to subscribe", { dir, cause: Cause.pretty(cause) })
            // Clean up a subscription that resolves after timeout
            pending.then((s) => s.unsubscribe()).catch(() => {})
            return Effect.void
          }),
        )
      }

      const cfg = yield* Effect.promise(() => Config.get())
      const cfgIgnores = cfg.watcher?.ignore ?? []

      if (yield* Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER) {
        yield* subscribe(instance.directory, [...FileIgnore.PATTERNS, ...cfgIgnores, ...Protected.paths()])
      }

      if (instance.project.vcs === "git") {
        const result = yield* Effect.promise(() =>
          git(["rev-parse", "--git-dir"], {
            cwd: instance.project.worktree,
          }),
        )
        const vcsDir = result.exitCode === 0 ? path.resolve(instance.project.worktree, result.text().trim()) : undefined
        if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
          const ignore = (yield* Effect.promise(() => readdir(vcsDir).catch(() => []))).filter(
            (entry) => entry !== "HEAD",
          )
          yield* subscribe(vcsDir, ignore)
        }
      }

      return FileWatcherService.of({ init })
    }).pipe(
      Effect.catchCause((cause) => {
        log.error("failed to init watcher service", { cause: Cause.pretty(cause) })
        return Effect.succeed(FileWatcherService.of({ init }))
      }),
    ),
  )
}
