import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import type ParcelWatcher from "@parcel/watcher"
import { $ } from "bun"
import { Flag } from "@/flag/flag"
import { readdir } from "fs/promises"
import { createRequire } from "module"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const OPENCODE_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })
  const req = createRequire(import.meta.url)

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
      const binding = req(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCODE_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  const backend = lazy(() => {
    const platform = process.platform
    const mode =
      platform === "win32"
        ? "windows"
        : platform === "darwin"
          ? "fs-events"
          : platform === "linux"
            ? "inotify"
            : undefined
    if (!mode) {
      log.error("watcher backend not supported", { platform })
      return
    }
    log.info("watcher backend", { platform, backend: mode })
    return mode
  })

  export async function watch(
    dir: string,
    callback: ParcelWatcher.SubscribeCallback,
    ignore: string[] = [],
  ): Promise<ParcelWatcher.AsyncSubscription | undefined> {
    const w = watcher()
    if (!w) return
    const mode = backend()
    if (!mode) return
    const pending = w.subscribe(dir, callback, { ignore, backend: mode })
    const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
      log.error("failed to subscribe to directory", { error: err, dir })
      pending.then((s) => s.unsubscribe()).catch(() => {})
      return undefined
    })
    return sub
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") return {}
      log.info("init")
      const cfg = await Config.get()
      const subs: ParcelWatcher.AsyncSubscription[] = []
      const ignores = cfg.watcher?.ignore ?? []

      const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
        if (err) return
        for (const evt of evts) {
          if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
          if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
          if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
        }
      }

      if (Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER) {
        const sub = await watch(Instance.directory, subscribe, [...FileIgnore.PATTERNS, ...ignores])
        if (sub) subs.push(sub)
      }

      const vcsDir = await $`git rev-parse --git-dir`
        .quiet()
        .nothrow()
        .cwd(Instance.worktree)
        .text()
        .then((x) => path.resolve(Instance.worktree, x.trim()))
        .catch(() => undefined)
      if (vcsDir && !ignores.includes(".git") && !ignores.includes(vcsDir)) {
        const contents = await readdir(vcsDir).catch(() => [])
        const ignore = contents.filter((entry) => entry !== "HEAD")
        const sub = await watch(vcsDir, subscribe, ignore)
        if (sub) subs.push(sub)
      }

      return { subs }
    },
    async (state) => {
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init() {
    if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return
    state()
  }
}
