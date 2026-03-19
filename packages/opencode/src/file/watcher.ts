import { Cause, Effect, Layer, ServiceMap } from "effect"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import type ParcelWatcher from "@parcel/watcher"
import { readdir } from "fs/promises"
import path from "path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { git } from "@/util/git"
import { lazy } from "@/util/lazy"
import { Config } from "../config/config"
import { FileIgnore } from "./ignore"
import { Protected } from "./protected"
import { Log } from "../util/log"

declare const OPENCODE_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })
  const SUBSCRIBE_TIMEOUT_MS = 10_000

  export const Event = {
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

  function protecteds(dir: string) {
    return Protected.paths().filter((item) => {
      const rel = path.relative(dir, item)
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
    })
  }

  export const hasNativeBinding = () => !!watcher()

  export class Service extends ServiceMap.Service<Service, {}>()("@opencode/FileWatcher") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      if (yield* Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return Service.of({})

      log.info("init", { directory: instance.directory })

      const backend = getBackend()
      if (!backend) {
        log.error("watcher backend not supported", { directory: instance.directory, platform: process.platform })
        return Service.of({})
      }

      const w = watcher()
      if (!w) return Service.of({})

      log.info("watcher backend", { directory: instance.directory, platform: process.platform, backend })

      const subs: ParcelWatcher.AsyncSubscription[] = []
      yield* Effect.addFinalizer(() => Effect.promise(() => Promise.allSettled(subs.map((sub) => sub.unsubscribe()))))

      const cb: ParcelWatcher.SubscribeCallback = Instance.bind((err, evts) => {
        if (err) return
        for (const evt of evts) {
          if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
          if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
          if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
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
            pending.then((s) => s.unsubscribe()).catch(() => {})
            return Effect.void
          }),
        )
      }

      const cfg = yield* Effect.promise(() => Config.get())
      const cfgIgnores = cfg.watcher?.ignore ?? []

      if (yield* Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER) {
        yield* subscribe(instance.directory, [...FileIgnore.PATTERNS, ...cfgIgnores, ...protecteds(instance.directory)])
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

      return Service.of({})
    }).pipe(
      Effect.catchCause((cause) => {
        log.error("failed to init watcher service", { cause: Cause.pretty(cause) })
        return Effect.succeed(Service.of({}))
      }),
    ),
  )
}
