import "@opentui/solid/runtime-plugin-support"
import {
  type TuiDispose,
  type TuiPlugin,
  type TuiPluginApi,
  type TuiPluginMeta,
  type TuiPluginStatus,
  type TuiSlotPlugin,
  type TuiTheme,
} from "@opencode-ai/plugin/tui"
import path from "path"
import { fileURLToPath } from "url"

import { Config } from "@/config/config"
import { TuiConfig } from "@/config/tui"
import { Log } from "@/util/log"
import { errorData, errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { Instance } from "@/project/instance"
import { isDeprecatedPlugin, resolvePluginTarget, uniqueModuleEntries } from "@/plugin/shared"
import { PluginMeta } from "@/plugin/meta"
import { addTheme, hasTheme } from "../context/theme"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { INTERNAL_TUI_PLUGINS, type InternalTuiPlugin } from "./internal"
import { setupSlots, Slot as View } from "./slots"
import type { HostPluginApi, HostSlotPlugin, HostSlots } from "./slots"

type Loaded = {
  item?: Config.PluginSpec
  spec: string
  target: string
  retry: boolean
  mod: Record<string, unknown>
  install: TuiTheme["install"]
}
type Deps = {
  wait?: Promise<void>
}

type Api = HostPluginApi

type Scope = {
  lifecycle: TuiPluginApi["lifecycle"]
  wrap: (fn: (() => void) | undefined) => () => void
  dispose: () => Promise<void>
}

type Unit = {
  id: string
  key: string
  load: Loaded
  meta: TuiPluginMeta
  plugin: TuiPlugin
  opts: Config.PluginOptions | undefined
  enabled: boolean
  active?: Scope
}

type Run = {
  api: Api
  slots: HostSlots
  list: Unit[]
  map: Map<string, Unit>
}

type Ops = {
  list: () => ReadonlyArray<TuiPluginStatus>
  activatePlugin: (id: string) => Promise<boolean>
  deactivatePlugin: (id: string) => Promise<boolean>
}

const log = Log.create({ service: "tui.plugin" })
const DISPOSE_TIMEOUT_MS = 5000
const KV_KEY = "plugin_enabled"

function fail(message: string, data: Record<string, unknown>) {
  if (!("error" in data)) {
    log.error(message, data)
    console.error(`[tui.plugin] ${message}`, data)
    return
  }

  const text = `${message}: ${errorMessage(data.error)}`
  const next = { ...data, error: errorData(data.error) }
  log.error(text, next)
  console.error(`[tui.plugin] ${text}`, next)
}

type CleanupResult = { type: "ok" } | { type: "error"; error: unknown } | { type: "timeout" }

function runCleanup(fn: () => unknown, ms: number): Promise<CleanupResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ type: "timeout" })
    }, ms)

    Promise.resolve()
      .then(fn)
      .then(
        () => {
          resolve({ type: "ok" })
        },
        (error) => {
          resolve({ type: "error", error })
        },
      )
      .finally(() => {
        clearTimeout(timer)
      })
  })
}

function isTuiPlugin(value: unknown): value is TuiPlugin {
  return typeof value === "function"
}

function getTuiPlugin(value: unknown) {
  if (!isRecord(value) || !("tui" in value)) return
  if (!isTuiPlugin(value.tui)) return
  return value.tui
}

function isTheme(value: unknown) {
  if (!isRecord(value)) return false
  if (!isRecord(value.theme)) return false
  return true
}

function localDir(file: string) {
  const dir = path.dirname(file)
  if (path.basename(dir) === ".opencode") return path.join(dir, "themes")
  return path.join(dir, ".opencode", "themes")
}

function scopeDir(pluginMeta: TuiConfig.PluginMeta) {
  if (pluginMeta.scope === "local") return localDir(pluginMeta.source)
  return path.join(Global.Path.config, "themes")
}

function resolveDir(root: string) {
  if (root.startsWith("file://")) {
    const file = fileURLToPath(root)
    if (root.endsWith("/")) return file
    return path.dirname(file)
  }
  if (path.isAbsolute(root)) return root
  return path.resolve(process.cwd(), root)
}

function externalPluginDir(spec: string, target: string) {
  if (spec.startsWith("file://")) return resolveDir(spec)
  return resolveDir(target)
}

function internalPluginDir(root?: string) {
  if (!root) return process.cwd()
  return resolveDir(root)
}

function resolveThemePath(root: string, file: string) {
  if (file.startsWith("file://")) return fileURLToPath(file)
  if (path.isAbsolute(file)) return file
  return path.resolve(root, file)
}

function themeName(file: string) {
  return path.basename(file, path.extname(file))
}

function getPluginMeta(config: TuiConfig.Info, item: Config.PluginSpec) {
  const key = Config.getPluginName(item)
  return config.plugin_meta?.[key]
}

function makeInstallFn(meta: TuiConfig.PluginMeta, root: string, spec: string): TuiTheme["install"] {
  return async (file) => {
    const src = resolveThemePath(root, file)
    const theme = themeName(src)
    if (hasTheme(theme)) return

    const text = await Filesystem.readText(src).catch((error) => {
      log.warn("failed to read tui plugin theme", { path: spec, theme: src, error })
      return
    })
    if (text === undefined) return

    const fail = Symbol()
    const data = await Promise.resolve(text)
      .then((x) => JSON.parse(x))
      .catch((error) => {
        log.warn("failed to parse tui plugin theme", { path: spec, theme: src, error })
        return fail
      })
    if (data === fail) return

    if (!isTheme(data)) {
      log.warn("invalid tui plugin theme", { path: spec, theme: src })
      return
    }

    const dest = path.join(scopeDir(meta), `${theme}.json`)
    if (!(await Filesystem.exists(dest))) {
      await Filesystem.write(dest, text).catch((error) => {
        log.warn("failed to persist tui plugin theme", { path: spec, theme: src, dest, error })
      })
    }

    addTheme(theme, data)
  }
}

function waitDeps(state: Deps) {
  state.wait ??= TuiConfig.waitForDependencies().catch((error) => {
    log.warn("failed waiting for tui plugin dependencies", { error })
  })
  return state.wait
}

async function prepPlugin(config: TuiConfig.Info, item: Config.PluginSpec, retry = false): Promise<Loaded | undefined> {
  const spec = Config.pluginSpecifier(item)
  if (isDeprecatedPlugin(spec)) return
  log.info("loading tui plugin", { path: spec, retry })
  const target = await resolvePluginTarget(spec).catch((error) => {
    fail("failed to resolve tui plugin", { path: spec, retry, error })
    return
  })
  if (!target) return

  const root = externalPluginDir(spec, target)
  const pluginMeta = getPluginMeta(config, item)
  if (!pluginMeta) {
    log.warn("missing tui plugin metadata", {
      path: spec,
      retry,
      name: Config.getPluginName(item),
    })
    return
  }

  const install = makeInstallFn(pluginMeta, root, spec)
  const mod = await import(target).catch((error) => {
    fail("failed to load tui plugin", { path: spec, target, retry, error })
    return
  })
  if (!mod) return

  return {
    item,
    spec,
    target,
    retry,
    mod,
    install,
  }
}

function createMeta(
  spec: string,
  target: string,
  meta: { state: PluginMeta.State; entry: PluginMeta.Entry } | undefined,
  name?: string,
): TuiPluginMeta {
  if (meta) {
    return {
      state: meta.state,
      ...meta.entry,
    }
  }

  const source = spec.startsWith("internal:") ? "internal" : spec.startsWith("file://") ? "file" : "npm"
  const now = Date.now()
  return {
    state: source === "internal" ? "same" : "first",
    name: name ?? spec,
    source,
    spec,
    target,
    first_time: now,
    last_time: now,
    time_changed: now,
    load_count: 1,
    fingerprint: target,
  }
}

function prepInternalPlugin(item: InternalTuiPlugin): Loaded {
  const spec = `internal:${item.name}`
  const target = item.root ?? spec
  const root = internalPluginDir(item.root)

  return {
    spec,
    target,
    retry: false,
    mod: item.module,
    install: makeInstallFn(
      {
        scope: "global",
        source: target,
      },
      root,
      spec,
    ),
  }
}

function scope(load: Loaded, name: string) {
  const ctrl = new AbortController()
  let list: { key: symbol; fn: TuiDispose }[] = []
  let done = false

  const onDispose = (fn: TuiDispose) => {
    if (done) return () => {}
    const key = Symbol()
    list.push({ key, fn })
    let drop = false
    return () => {
      if (drop) return
      drop = true
      list = list.filter((x) => x.key !== key)
    }
  }

  const wrap = (fn: (() => void) | undefined) => {
    if (!fn) return () => {}
    const off = onDispose(fn)
    let drop = false
    return () => {
      if (drop) return
      drop = true
      off()
      fn()
    }
  }

  const lifecycle: TuiPluginApi["lifecycle"] = {
    signal: ctrl.signal,
    onDispose,
  }

  const dispose = async () => {
    if (done) return
    done = true
    ctrl.abort()
    const queue = [...list].reverse()
    list = []
    const until = Date.now() + DISPOSE_TIMEOUT_MS
    for (const item of queue) {
      const left = until - Date.now()
      if (left <= 0) {
        fail("timed out cleaning up tui plugin", {
          path: load.spec,
          name,
          timeout: DISPOSE_TIMEOUT_MS,
        })
        break
      }

      const out = await runCleanup(item.fn, left)
      if (out.type === "ok") continue
      if (out.type === "timeout") {
        fail("timed out cleaning up tui plugin", {
          path: load.spec,
          name,
          timeout: DISPOSE_TIMEOUT_MS,
        })
        break
      }

      if (out.type === "error") {
        fail("failed to clean up tui plugin", {
          path: load.spec,
          name,
          error: out.error,
        })
      }
    }
  }

  return {
    lifecycle,
    wrap,
    dispose,
  }
}

function sid(meta: TuiPluginMeta, name: string) {
  if (meta.source === "internal") {
    const base = `internal:${meta.name}`
    if (name === "default") return base
    return `${base}:${name}`
  }
  if (name === "default") return meta.name
  return `${meta.name}:${name}`
}

function own(value: unknown, load: Loaded, key: string) {
  if (!isRecord(value)) return
  if (!("id" in value)) return
  if (typeof value.id !== "string") {
    log.warn("ignoring invalid tui plugin id", {
      path: load.spec,
      name: key,
      type: typeof value.id,
    })
    return
  }
  const id = value.id.trim()
  if (id) return id
  log.warn("ignoring empty tui plugin id", {
    path: load.spec,
    name: key,
  })
}

function bools(value: unknown) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((item): item is [string, boolean] => typeof item[1] === "boolean"),
  )
}

function save(api: Api, id: string, enabled: boolean) {
  const next = {
    ...bools(api.kv.get(KV_KEY, {})),
    [id]: enabled,
  }
  api.kv.set(KV_KEY, next)
}

function status(run: Run): TuiPluginStatus[] {
  return run.list.map((item) => ({
    id: item.id,
    name: item.meta.name,
    source: item.meta.source,
    spec: item.meta.spec,
    target: item.meta.target,
    enabled: item.enabled,
    active: item.active !== undefined,
  }))
}

async function stop(item: Unit, persist: boolean, api: Api) {
  item.enabled = false
  if (persist) save(api, item.id, false)
  if (!item.active) return true
  const active = item.active
  item.active = undefined
  await active.dispose()
  return true
}

async function start(item: Unit, run: Run, persist: boolean) {
  item.enabled = true
  if (persist) save(run.api, item.id, true)
  if (item.active) return true

  const active = scope(item.load, item.key)
  const plugin = pluginApi(run.api, run.slots, item.load, active, item.id, {
    list() {
      return status(run)
    },
    activatePlugin(id) {
      return TuiPluginRuntime.activatePlugin(id)
    },
    deactivatePlugin(id) {
      return TuiPluginRuntime.deactivatePlugin(id)
    },
  })
  const ready = await Promise.resolve()
    .then(async () => {
      await item.plugin(plugin, item.opts, item.meta)
      return true
    })
    .catch((error) => {
      fail("failed to initialize tui plugin export", {
        path: item.load.spec,
        name: item.key,
        error,
      })
      return false
    })

  if (!ready) {
    await active.dispose()
    return false
  }

  item.active = active
  return true
}

function plug(plugin: TuiSlotPlugin, id: string): HostSlotPlugin {
  return {
    ...plugin,
    id,
  }
}

function pluginApi(api: Api, host: HostSlots, load: Loaded, state: Scope, base: string, ops: Ops): TuiPluginApi {
  const command: TuiPluginApi["command"] = {
    register(cb) {
      return state.wrap(api.command.register(cb))
    },
    trigger(value) {
      api.command.trigger(value)
    },
  }

  const route: TuiPluginApi["route"] = {
    register(list) {
      return state.wrap(api.route.register(list))
    },
    navigate(name, params) {
      api.route.navigate(name, params)
    },
    get current() {
      return api.route.current
    },
  }

  const theme: TuiPluginApi["theme"] = Object.assign(Object.create(api.theme), {
    install: load.install,
  })

  const event: TuiPluginApi["event"] = {
    on(type, handler) {
      return state.wrap(api.event.on(type, handler))
    },
  }

  let count = 0

  const slots: TuiPluginApi["slots"] = {
    register(plugin) {
      const id = count ? `${base}:${count}` : base
      count += 1
      state.wrap(host.register(plug(plugin, id)))
      return id
    },
  }

  return {
    app: api.app,
    command,
    route,
    ui: api.ui,
    keybind: api.keybind,
    tuiConfig: api.tuiConfig,
    kv: api.kv,
    state: api.state,
    theme,
    get client() {
      return api.client
    },
    scopedClient: api.scopedClient,
    workspace: api.workspace,
    event,
    renderer: api.renderer,
    slots,
    plugins: {
      list: ops.list,
      activatePlugin: ops.activatePlugin,
      deactivatePlugin: ops.deactivatePlugin,
    },
    lifecycle: state.lifecycle,
  }
}

function units(load: Loaded, meta: TuiPluginMeta) {
  const list: Unit[] = []
  const opts = load.item ? Config.pluginOptions(load.item) : undefined

  for (const [key, value] of uniqueModuleEntries(load.mod)) {
    if (!value || typeof value !== "object") {
      log.warn("ignoring non-object tui plugin export", {
        path: load.spec,
        name: key,
        type: value === null ? "null" : typeof value,
      })
      continue
    }

    const plugin = getTuiPlugin(value)
    if (!plugin) continue
    const id = own(value, load, key) ?? sid(meta, key)
    list.push({
      id,
      key,
      load,
      meta,
      plugin,
      opts,
      enabled: true,
    })
  }

  return list
}

function push(run: Run, item: Unit) {
  if (run.map.has(item.id)) {
    fail("duplicate tui plugin id", {
      id: item.id,
      path: item.load.spec,
      name: item.key,
    })
    return
  }

  run.map.set(item.id, item)
  run.list.push(item)
}

function mark(run: Run, config: TuiConfig.Info) {
  const map = {
    ...bools(config.plugin_enabled),
    ...bools(run.api.kv.get(KV_KEY, {})),
  }
  for (const item of run.list) {
    const hit = map[item.id]
    if (hit === undefined) continue
    item.enabled = hit
  }
}

export namespace TuiPluginRuntime {
  let dir = ""
  let loaded: Promise<void> | undefined
  let run: Run | undefined
  export const Slot = View

  export async function init(api: HostPluginApi) {
    const cwd = process.cwd()
    if (loaded) {
      if (dir !== cwd) {
        throw new Error(`TuiPluginRuntime.init() called with a different working directory. expected=${dir} got=${cwd}`)
      }
      return loaded
    }

    dir = cwd
    loaded = load(api)
    return loaded
  }

  export function list() {
    if (!run) return []
    return status(run)
  }

  export async function activatePlugin(id: string) {
    const item = run?.map.get(id)
    if (!item || !run) return false
    return start(item, run, true)
  }

  export async function deactivatePlugin(id: string) {
    const item = run?.map.get(id)
    if (!item || !run) return false
    return stop(item, true, run.api)
  }

  export async function dispose() {
    const task = loaded
    loaded = undefined
    dir = ""
    if (task) await task
    const hit = run
    run = undefined
    if (!hit) return
    const queue = [...hit.list].reverse()
    for (const item of queue) {
      await stop(item, false, hit.api)
    }
  }

  async function load(api: Api) {
    const cwd = process.cwd()
    const slots = setupSlots(api)
    const next: Run = {
      api,
      slots,
      list: [],
      map: new Map(),
    }
    run = next

    await Instance.provide({
      directory: cwd,
      fn: async () => {
        const config = await TuiConfig.get()
        const plugins = Flag.OPENCODE_PURE ? [] : (config.plugin ?? [])
        if (Flag.OPENCODE_PURE && config.plugin?.length) {
          log.info("skipping external tui plugins in pure mode", { count: config.plugin.length })
        }
        const deps: Deps = {}

        for (const item of INTERNAL_TUI_PLUGINS) {
          log.info("loading internal tui plugin", { name: item.name })
          const entry = prepInternalPlugin(item)
          const meta = createMeta(entry.spec, entry.target, undefined, item.name)
          for (const plugin of units(entry, meta)) {
            push(next, plugin)
          }
        }

        const loaded = await Promise.all(plugins.map((item) => prepPlugin(config, item)))
        const ready: Loaded[] = []

        for (let i = 0; i < plugins.length; i++) {
          let entry = loaded[i]
          if (!entry) {
            const item = plugins[i]
            if (!item) continue
            const spec = Config.pluginSpecifier(item)
            if (!spec.startsWith("file://")) continue
            await waitDeps(deps)
            entry = await prepPlugin(config, item, true)
          }
          if (!entry) continue
          ready.push(entry)
        }

        const meta = await PluginMeta.touchMany(ready.map((item) => ({ spec: item.spec, target: item.target }))).catch(
          (error) => {
            log.warn("failed to track tui plugins", { error })
            return undefined
          },
        )

        for (let i = 0; i < ready.length; i++) {
          const entry = ready[i]
          if (!entry) continue
          const hit = meta?.[i]
          if (hit && hit.state !== "same") {
            log.info("tui plugin metadata updated", {
              path: entry.spec,
              retry: entry.retry,
              state: hit.state,
              source: hit.entry.source,
              version: hit.entry.version,
              modified: hit.entry.modified,
            })
          }

          const row = createMeta(entry.spec, entry.target, hit)
          for (const plugin of units(entry, row)) {
            push(next, plugin)
          }
        }

        mark(next, config)
        for (const item of next.list) {
          if (!item.enabled) continue
          await start(item, next, false)
        }
      },
    }).catch((error) => {
      fail("failed to load tui plugins", { directory: cwd, error })
    })
  }
}
