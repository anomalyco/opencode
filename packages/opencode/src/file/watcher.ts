import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
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

  // Per-instance state for config watcher debouncing and in-flight guard
  interface ConfigWatcherState {
    disposeInFlight: boolean
    debounceTimer: ReturnType<typeof setTimeout> | undefined
  }

  function handleConfigChange(file: string, event: "add" | "change" | "unlink", configState: ConfigWatcherState) {
    log.info("config file changed", { file, event })
    Bus.publish(Event.ConfigChanged, { file, event })

    // Debounce and guard against overlapping dispose calls
    if (configState.debounceTimer) {
      clearTimeout(configState.debounceTimer)
    }

    configState.debounceTimer = setTimeout(async () => {
      if (configState.disposeInFlight) {
        log.debug("dispose already in flight, skipping")
        return
      }

      configState.disposeInFlight = true
      try {
        log.info("reloading instance due to config change")
        await Instance.dispose()
      } catch (error) {
        log.error("failed to dispose instance", { error })
      } finally {
        configState.disposeInFlight = false
      }
    }, CONFIG_DEBOUNCE_MS)
  }

  // Check if a file path is at the root level of the watched directory
  function isRootLevelFile(filePath: string, watchedDir: string): boolean {
    const rel = path.relative(watchedDir, filePath)
    // Root level = no path separators in relative path
    return rel.length > 0 && !rel.includes(path.sep) && !rel.startsWith("..")
  }

  // Create callback for config file watching (filters to config files only)
  function createConfigCallback(watchedDir: string, configState: ConfigWatcherState): ParcelWatcher.SubscribeCallback {
    return (err, evts) => {
      if (err) return
      for (const evt of evts) {
        const filename = path.basename(evt.path)
        // Only process config files at the root of the watched directory
        if (!isRootLevelFile(evt.path, watchedDir)) continue
        if (!CONFIG_FILES.has(filename)) continue

        const event = evt.type === "create" ? "add" : evt.type === "update" ? "change" : "unlink"
        handleConfigChange(evt.path, event, configState)
      }
    }
  }

  // Subscribe to a directory for config file changes
  async function subscribeConfigDir(
    w: typeof import("@parcel/watcher"),
    dir: string,
    backend: "windows" | "fs-events" | "inotify",
    configState: ConfigWatcherState,
  ): Promise<ParcelWatcher.AsyncSubscription | undefined> {
    try {
      const pending = w.subscribe(dir, createConfigCallback(dir, configState), {
        // Ignore subdirectories - only watch root level files
        // Note: callback also filters, this is defense in depth
        ignore: ["*/**"],
        backend,
      })
      const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
        log.error("failed to subscribe to config directory", { error: err, dir })
        pending.then((s) => s.unsubscribe()).catch(() => {})
        return undefined
      })
      if (sub) {
        log.info("watching config directory", { dir })
      }
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
      const cfgIgnores = cfg.watcher?.ignore ?? []

      // Per-instance config watcher state
      const configState: ConfigWatcherState = {
        disposeInFlight: false,
        debounceTimer: undefined,
      }

      // --- Config file watching (always enabled unless explicitly disabled) ---
      if (!Flag.OPENCODE_DISABLE_CONFIG_WATCHER) {
        // Watch project directory for config files
        const projectSub = await subscribeConfigDir(w, Instance.directory, backend, configState)
        if (projectSub) subs.push(projectSub)

        // Watch .opencode subdirectory if it exists
        const dotOpencode = path.join(Instance.directory, ".opencode")
        if (await Filesystem.exists(dotOpencode)) {
          const dotSub = await subscribeConfigDir(w, dotOpencode, backend, configState)
          if (dotSub) subs.push(dotSub)
        }

        // Watch ~/.opencode directory if it exists (user home)
        const homeOpencode = path.join(Global.Path.home, ".opencode")
        if (homeOpencode !== dotOpencode && (await Filesystem.exists(homeOpencode))) {
          const homeSub = await subscribeConfigDir(w, homeOpencode, backend, configState)
          if (homeSub) subs.push(homeSub)
        }

        // Watch global config directory (if different from project and home)
        const globalConfig = Global.Path.config
        if (globalConfig !== Instance.directory && globalConfig !== homeOpencode) {
          const globalSub = await subscribeConfigDir(w, globalConfig, backend, configState)
          if (globalSub) subs.push(globalSub)
        }
      }

      // --- General file watching (experimental, git-only) ---
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
          ignore: [...FileIgnore.PATTERNS, ...cfgIgnores],
          backend,
        })
        const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
          log.error("failed to subscribe to Instance.directory", { error: err })
          pending.then((s) => s.unsubscribe()).catch(() => {})
          return undefined
        })
        if (sub) subs.push(sub)
      }

      // --- Git HEAD watching (git-only) ---
      if (Instance.project.vcs === "git") {
        const vcsDir = await $`git rev-parse --git-dir`
          .quiet()
          .nothrow()
          .cwd(Instance.worktree)
          .text()
          .then((x) => path.resolve(Instance.worktree, x.trim()))
          .catch(() => undefined)
        if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
          const gitDirContents = await readdir(vcsDir).catch(() => [])
          const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
          const pending = w.subscribe(vcsDir, subscribe, {
            ignore: ignoreList,
            backend,
          })
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
      // Clean up debounce timer
      if (state.configState?.debounceTimer) {
        clearTimeout(state.configState.debounceTimer)
        state.configState.debounceTimer = undefined
      }
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init() {
    if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER && Flag.OPENCODE_DISABLE_CONFIG_WATCHER) {
      return
    }
    state()
  }
}
