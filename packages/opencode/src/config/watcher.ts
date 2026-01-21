import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Config } from "./config"
import { FileWatcher } from "../file/watcher"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { Event as ServerEvent } from "../server/event"
import { lazy } from "../util/lazy"
import path from "path"
import type ParcelWatcher from "@parcel/watcher"

const CONFIG_DEBOUNCE_MS = 500
const CONFIG_FILES = new Set(["opencode.json", "opencode.jsonc", "config.json"])

type Scope = "global" | "local"

interface DebounceState {
  inFlight: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

interface WatchState {
  subs: ParcelWatcher.AsyncSubscription[]
  guard: DebounceState
}

const log = Log.create({ service: "config.watcher" })

export namespace ConfigWatcher {
  export const Event = {
    Changed: BusEvent.define(
      "config.watcher.changed",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
        scope: z.union([z.literal("global"), z.literal("local")]),
      }),
    ),
  }

  const globalPaths = lazy(async () => {
    const dirs = new Set<string>()
    dirs.add(Global.Path.config)
    if (Flag.OPENCODE_CONFIG_DIR) dirs.add(Flag.OPENCODE_CONFIG_DIR)

    const home = await Array.fromAsync(
      Filesystem.up({
        targets: [".opencode"],
        start: Global.Path.home,
        stop: Global.Path.home,
      }),
    )
    for (const dir of home) dirs.add(dir)

    return {
      dirs: Array.from(dirs),
      file: Flag.OPENCODE_CONFIG,
    }
  })

  const globalState = lazy(async (): Promise<WatchState> => {
    const guard: DebounceState = {
      inFlight: false,
      timer: undefined,
    }
    const subs: ParcelWatcher.AsyncSubscription[] = []
    const global = await globalPaths()
    for (const dir of global.dirs) {
      if (!(await Filesystem.exists(dir))) continue
      const sub = await watchDir(dir, "global", guard, matchesConfig, ["*/**"])
      if (sub) subs.push(sub)
    }

    if (global.file) {
      const sub = await watchDir(path.dirname(global.file), "global", guard, matchesFile(global.file), ["*/**"])
      if (sub) subs.push(sub)
    }

    return { subs, guard }
  })

  const localState = Instance.state(
    async (): Promise<WatchState> => {
      const guard: DebounceState = {
        inFlight: false,
        timer: undefined,
      }
      const subs: ParcelWatcher.AsyncSubscription[] = []
      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
        const global = await globalPaths()
        const roots = parents(Instance.directory, Instance.worktree)
        const opencode = await Array.fromAsync(
          Filesystem.up({
            targets: [".opencode"],
            start: Instance.directory,
            stop: Instance.worktree,
          }),
        )

        const skip = new Set(global.dirs)
        const match = global.file
          ? (file: string, dir: string) => matchesConfig(file, dir) && file !== global.file
          : matchesConfig
        for (const dir of [...roots, ...opencode]) {
          if (skip.has(dir)) continue
          const sub = await watchDir(dir, "local", guard, match, ["*/**"])
          if (sub) subs.push(sub)
        }
      }

      return { subs, guard }
    },
    async (state) => {
      if (state.guard.timer) {
        clearTimeout(state.guard.timer)
        state.guard.timer = undefined
      }
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init() {
    if (!Flag.OPENCODE_EXPERIMENTAL_CONFIG_WATCHER) return
    globalState()
    localState()
  }
}

function parents(start: string, stop: string): string[] {
  if (start === stop) return [start]
  const parent = path.dirname(start)
  if (parent === start) return [start]
  return [start, ...parents(parent, stop)]
}

function matchesConfig(file: string, dir: string): boolean {
  if (!isRoot(file, dir)) return false
  return CONFIG_FILES.has(path.basename(file))
}

function matchesFile(target: string) {
  return (file: string, _dir: string) => file === target
}

function isRoot(file: string, dir: string): boolean {
  const rel = path.relative(dir, file)
  return rel.length > 0 && !rel.includes(path.sep) && !rel.startsWith("..")
}

function watchDir(
  dir: string,
  scope: Scope,
  guard: DebounceState,
  match: (file: string, dir: string) => boolean,
  ignore: string[],
) {
  const callback: ParcelWatcher.SubscribeCallback = (err, evts) => {
    if (err) return
    for (const evt of evts) {
      const event = toEvent(evt.type)
      if (!event) continue
      if (!match(evt.path, dir)) continue
      handleChange(evt.path, event, scope, guard)
    }
  }
  return FileWatcher.watch(dir, callback, ignore)
}

function toEvent(type: string) {
  if (type === "create") return "add"
  if (type === "update") return "change"
  if (type === "delete") return "unlink"
  return undefined
}

function handleChange(file: string, event: "add" | "change" | "unlink", scope: Scope, guard: DebounceState) {
  log.info("config file changed", { file, event, scope })
  Bus.publish(ConfigWatcher.Event.Changed, { file, event, scope })

  if (scope === "global") {
    schedule(guard, reloadGlobal)
    return
  }
  schedule(guard, reloadLocal)
}

function schedule(state: DebounceState, fn: () => Promise<void>) {
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(async () => {
    if (state.inFlight) {
      log.debug("reload already in flight, skipping")
      return
    }
    state.inFlight = true
    try {
      await fn()
    } catch (error) {
      log.error("failed to reload config", { error })
    } finally {
      state.inFlight = false
    }
  }, CONFIG_DEBOUNCE_MS)
}

async function reloadLocal() {
  log.info("reloading instance due to config change", { scope: "local" })
  await Instance.dispose()
}

async function reloadGlobal() {
  log.info("reloading instances due to config change", { scope: "global" })
  Config.global.reset()
  await Instance.disposeAll()
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: ServerEvent.Disposed.type,
      properties: {},
    },
  })
}
