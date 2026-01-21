import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import { Global } from "../global"
import { Filesystem } from "@/util/filesystem"
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
const CONFIG_DEBOUNCE_MS = 500

declare const OPENCODE_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  const CONFIG_FILES = new Set(["opencode.json", "opencode.jsonc", "config.json"])

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
    ConfigChanged: BusEvent.define(
      "file.watcher.config.changed",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  // Create require function that works in browser conditions
  const require = createRequire(import.meta.url)

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

  interface ConfigWatcherState {
    inFlight: boolean
    timer: ReturnType<typeof setTimeout> | undefined
  }

  function handleConfigChange(file: string, event: "add" | "change" | "unlink", state: ConfigWatcherState) {
    log.info("config file changed", { file, event })
    Bus.publish(Event.ConfigChanged, { file, event })

    if (state.timer) clearTimeout(state.timer)

    state.timer = setTimeout(async () => {
      if (state.inFlight) {
        log.debug("dispose already in flight, skipping")
        return
      }

      state.inFlight = true
      try {
        Config.global.reset()
        log.info("reloading instance due to config change")
        await Instance.dispose()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: "global.disposed",
            properties: {},
          },
        })
      } catch (error) {
        log.error("failed to dispose instance", { error })
      } finally {
        state.inFlight = false
      }
    }, CONFIG_DEBOUNCE_MS)
  }

  function isRootLevel(file: string, dir: string): boolean {
    const rel = path.relative(dir, file)
    return rel.length > 0 && !rel.includes(path.sep) && !rel.startsWith("..")
  }

  function createConfigCallback(dir: string, state: ConfigWatcherState): ParcelWatcher.SubscribeCallback {
    return (err, evts) => {
      if (err) return
      for (const evt of evts) {
        const filename = path.basename(evt.path)
        if (!isRootLevel(evt.path, dir)) continue
        if (!CONFIG_FILES.has(filename)) continue

        const event = evt.type === "create" ? "add" : evt.type === "update" ? "change" : "unlink"
        handleConfigChange(evt.path, event, state)
      }
    }
  }

  async function subscribeConfigDir(
    w: typeof import("@parcel/watcher"),
    dir: string,
    backend: "windows" | "fs-events" | "inotify",
    state: ConfigWatcherState,
  ): Promise<ParcelWatcher.AsyncSubscription | undefined> {
    try {
      const pending = w.subscribe(dir, createConfigCallback(dir, state), {
        ignore: ["*/**"],
        backend,
      })
      const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
        log.error("failed to subscribe to config directory", { error: err, dir })
        pending.then((s) => s.unsubscribe()).catch(() => {})
        return undefined
      })
      if (sub) log.info("watching config directory", { dir })
      return sub
    } catch (error) {
      log.error("failed to watch config directory", { error, dir })
      return undefined
    }
  }

  const state = Instance.state(
    async () => {
      log.info("init")
      const cfg = await Config.get()
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
      })()
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }
      log.info("watcher backend", { platform: process.platform, backend })

      const w = watcher()
      if (!w) return {}

      const subs: ParcelWatcher.AsyncSubscription[] = []
      const ignores = cfg.watcher?.ignore ?? []

      const configState: ConfigWatcherState = {
        inFlight: false,
        timer: undefined,
      }

      // Config file watching (experimental, opt-in)
      if (Flag.OPENCODE_EXPERIMENTAL_CONFIG_WATCHER) {
        const projectSub = await subscribeConfigDir(w, Instance.directory, backend, configState)
        if (projectSub) subs.push(projectSub)

        const dotOpencode = path.join(Instance.directory, ".opencode")
        if (await Filesystem.exists(dotOpencode)) {
          const sub = await subscribeConfigDir(w, dotOpencode, backend, configState)
          if (sub) subs.push(sub)
        }

        const homeOpencode = path.join(Global.Path.home, ".opencode")
        if (homeOpencode !== dotOpencode && (await Filesystem.exists(homeOpencode))) {
          const sub = await subscribeConfigDir(w, homeOpencode, backend, configState)
          if (sub) subs.push(sub)
        }

        const globalConfig = Global.Path.config
        if (globalConfig !== Instance.directory && globalConfig !== homeOpencode) {
          const sub = await subscribeConfigDir(w, globalConfig, backend, configState)
          if (sub) subs.push(sub)
        }
      }

      // General file watching (experimental)
      const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
        if (err) return
        for (const evt of evts) {
          if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
          if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
          if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
        }
      }

      if (Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER) {
        const pending = w.subscribe(Instance.directory, subscribe, {
          ignore: [...FileIgnore.PATTERNS, ...ignores],
          backend,
        })
        const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
          log.error("failed to subscribe to Instance.directory", { error: err })
          pending.then((s) => s.unsubscribe()).catch(() => {})
          return undefined
        })
        if (sub) subs.push(sub)
      }

      // Git HEAD watching
      if (Instance.project.vcs === "git") {
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
          const pending = w.subscribe(vcsDir, subscribe, { ignore, backend })
          const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
            log.error("failed to subscribe to vcsDir", { error: err })
            pending.then((s) => s.unsubscribe()).catch(() => {})
            return undefined
          })
          if (sub) subs.push(sub)
        }
      }

      return { subs, configState }
    },
    async (state) => {
      if (state.configState?.timer) {
        clearTimeout(state.configState.timer)
        state.configState.timer = undefined
      }
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init() {
    if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER && !Flag.OPENCODE_EXPERIMENTAL_CONFIG_WATCHER) return
    state()
  }
}
