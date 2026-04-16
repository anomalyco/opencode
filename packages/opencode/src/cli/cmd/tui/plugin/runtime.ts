// import "@opentui/solid/runtime-plugin-support"
import {
  type TuiDispose,
  type TuiPlugin,
  type TuiPluginApi,
  type TuiPluginInstallResult,
  type TuiPluginModule,
  type TuiPluginMeta,
  type TuiPluginStatus,
  type TuiSlotPlugin,
  type TuiTheme,
} from "@opencode-ai/plugin/tui"
import path from "path"
import { fileURLToPath } from "url"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { Log } from "@/util"
import { errorData, errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import {
  readPackageThemes,
  readPluginId,
  readV1Plugin,
  resolvePluginId,
  type PluginPackage,
  type PluginSource,
} from "@/plugin/shared"
import { PluginLoader } from "@/plugin/loader"
import { PluginMeta } from "@/plugin/meta"
import { installPlugin as installModulePlugin, patchPluginConfig, readPluginManifest } from "@/plugin/install"
import { hasTheme, upsertTheme } from "../context/theme"
import { Global } from "@/global"
import { Filesystem } from "@/util"
import { Process } from "@/util"
import { Flock } from "@opencode-ai/shared/util/flock"
import { Flag } from "@/flag/flag"
import { INTERNAL_TUI_PLUGINS, type InternalTuiPlugin } from "./internal"
import { setupSlots, Slot as View } from "./slots"
import type { HostPluginApi, HostSlots } from "./slots"
import { ConfigPlugin } from "@/config/plugin"

type PluginLoad = {
  options: ConfigPlugin.Options | undefined
  spec: string
  target: string
  retry: boolean
  source: PluginSource | "internal"
  id: string
  module: TuiPluginModule
  origin: ConfigPlugin.Origin
  theme_root: string
  theme_files: string[]
}

type Api = HostPluginApi

type PluginScope = {
  lifecycle: TuiPluginApi["lifecycle"]
  track: (fn: (() => void) | undefined) => () => void
  dispose: () => Promise<void>
}

type PluginEntry = {
  id: string
  load: PluginLoad
  meta: TuiPluginMeta
  themes: Record<string, PluginMeta.Theme>
  plugin: TuiPlugin
  enabled: boolean
  scope?: PluginScope
}

type RuntimeState = {
  directory: string
  api: Api
  slots: HostSlots
  plugins: PluginEntry[]
  plugins_by_id: Map<string, PluginEntry>
  pending: Map<string, ConfigPlugin.Origin>
}

const log = Log.create({ service: "tui.plugin" })
const DISPOSE_TIMEOUT_MS = 5000
const KV_KEY = "plugin_enabled"
const EMPTY_TUI: TuiPluginModule = {
  tui: async () => {},
}

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

function warn(message: string, data: Record<string, unknown>) {
  log.warn(message, data)
  console.warn(`[tui.plugin] ${message}`, data)
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

function isTheme(value: unknown) {
  if (!isRecord(value)) return false
  if (!("theme" in value)) return false
  if (!isRecord(value.theme)) return false
  return true
}

function resolveRoot(root: string) {
  if (root.startsWith("file://")) {
    const file = fileURLToPath(root)
    if (root.endsWith("/")) return file
    return path.dirname(file)
  }
  if (path.isAbsolute(root)) return root
  return path.resolve(process.cwd(), root)
}

function createThemeInstaller(
  meta: ConfigPlugin.Origin,
  root: string,
  spec: string,
  plugin: PluginEntry,
): TuiTheme["install"] {
  return async (file) => {
    const raw = file.startsWith("file://") ? fileURLToPath(file) : file
    const src = path.isAbsolute(raw) ? raw : path.resolve(root, raw)
    const name = path.basename(src, path.extname(src))
    const source_dir = path.dirname(meta.source)
    const local_dir =
      path.basename(source_dir) === ".opencode"
        ? path.join(source_dir, "themes")
        : path.join(source_dir, ".opencode", "themes")
    const dest_dir = meta.scope === "local" ? local_dir : path.join(Global.Path.config, "themes")
    const dest = path.join(dest_dir, `${name}.json`)
    const stat = await Filesystem.statAsync(src)
    const mtime = stat ? Math.floor(typeof stat.mtimeMs === "bigint" ? Number(stat.mtimeMs) : stat.mtimeMs) : undefined
    const size = stat ? (typeof stat.size === "bigint" ? Number(stat.size) : stat.size) : undefined
    const info = {
      src,
      dest,
      mtime,
      size,
    }

    await Flock.withLock(`tui-theme:${dest}`, async () => {
      const save = async () => {
        plugin.themes[name] = info
        await PluginMeta.setTheme(plugin.id, name, info).catch((error) => {
          log.warn("failed to track tui plugin theme", {
            path: spec,
            id: plugin.id,
            theme: src,
            dest,
            error,
          })
        })
      }

      const exists = hasTheme(name)
      const prev = plugin.themes[name]
      if (exists) {
        if (plugin.meta.state !== "updated") {
          if (!prev && (await Filesystem.exists(dest))) {
            await save()
          }
          return
        }
        if (path.normalize(prev?.dest ?? "") === path.normalize(dest) && prev.mtime === mtime && prev.size === size)
          return
      }

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

      if (exists || !(await Filesystem.exists(dest))) {
        await Filesystem.write(dest, text).catch((error) => {
          log.warn("failed to persist tui plugin theme", { path: spec, theme: src, dest, error })
        })
      }

      upsertTheme(name, data)
      await save()
    }).catch((error) => {
      log.warn("failed to lock tui plugin theme install", { path: spec, theme: src, dest, error })
    })
  }
}

function createMeta(
  source: PluginLoad["source"],
  spec: string,
  target: string,
  meta: { state: PluginMeta.State; entry: PluginMeta.Entry } | undefined,
  id?: string,
): TuiPluginMeta {
  if (meta) {
    return {
      state: meta.state,
      ...meta.entry,
    }
  }

  const now = Date.now()
  return {
    state: source === "internal" ? "same" : "first",
    id: id ?? spec,
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

function loadInternalPlugin(item: InternalTuiPlugin): PluginLoad {
  const spec = item.id
  const target = spec

  return {
    options: undefined,
    spec,
    target,
    retry: false,
    source: "internal",
    id: item.id,
    module: item,
    origin: {
      spec,
      scope: "global",
      source: target,
    },
    theme_root: process.cwd(),
    theme_files: [],
  }
}

async function readThemeFiles(spec: string, pkg?: PluginPackage) {
  if (!pkg) return [] as string[]
  return Promise.resolve()
    .then(() => readPackageThemes(spec, pkg))
    .catch((error) => {
      warn("invalid tui plugin oc-themes", {
        path: spec,
        pkg: pkg.pkg,
        error,
      })
      return [] as string[]
    })
}

async function syncPluginThemes(plugin: PluginEntry) {
  if (!plugin.load.theme_files.length) return
  if (plugin.meta.state === "same") return
  const install = createThemeInstaller(plugin.load.origin, plugin.load.theme_root, plugin.load.spec, plugin)
  for (const file of plugin.load.theme_files) {
    await install(file).catch((error) => {
      warn("failed to sync tui plugin oc-themes", { path: plugin.load.spec, id: plugin.id, theme: file, error })
    })
  }
}

function createPluginScope(load: PluginLoad, id: string) {
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

  const track = (fn: (() => void) | undefined) => {
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
          id,
          timeout: DISPOSE_TIMEOUT_MS,
        })
        break
      }

      const out = await runCleanup(item.fn, left)
      if (out.type === "ok") continue
      if (out.type === "timeout") {
        fail("timed out cleaning up tui plugin", {
          path: load.spec,
          id,
          timeout: DISPOSE_TIMEOUT_MS,
        })
        break
      }

      if (out.type === "error") {
        fail("failed to clean up tui plugin", {
          path: load.spec,
          id,
          error: out.error,
        })
      }
    }
  }

  return {
    lifecycle,
    track,
    dispose,
  }
}

function readPluginEnabledMap(value: unknown) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((item): item is [string, boolean] => typeof item[1] === "boolean"),
  )
}

function pluginEnabledState(state: RuntimeState, config: TuiConfig.Info) {
  return {
    ...readPluginEnabledMap(config.plugin_enabled),
    ...readPluginEnabledMap(state.api.kv.get(KV_KEY, {})),
  }
}

function writePluginEnabledState(api: Api, id: string, enabled: boolean) {
  api.kv.set(KV_KEY, {
    ...readPluginEnabledMap(api.kv.get(KV_KEY, {})),
    [id]: enabled,
  })
}

function listPluginStatus(state: RuntimeState): TuiPluginStatus[] {
  return state.plugins.map((plugin) => ({
    id: plugin.id,
    source: plugin.meta.source,
    spec: plugin.meta.spec,
    target: plugin.meta.target,
    enabled: plugin.enabled,
    active: plugin.scope !== undefined,
  }))
}

async function deactivatePluginEntry(state: RuntimeState, plugin: PluginEntry, persist: boolean) {
  plugin.enabled = false
  if (persist) writePluginEnabledState(state.api, plugin.id, false)
  if (!plugin.scope) return true
  const scope = plugin.scope
  plugin.scope = undefined
  await scope.dispose()
  return true
}

async function activatePluginEntry(state: RuntimeState, plugin: PluginEntry, persist: boolean) {
  plugin.enabled = true
  if (persist) writePluginEnabledState(state.api, plugin.id, true)
  if (plugin.scope) return true

  const scope = createPluginScope(plugin.load, plugin.id)
  const api = pluginApi(state, plugin, scope, plugin.id)
  const ok = await Promise.resolve()
    .then(async () => {
      await syncPluginThemes(plugin)
      await plugin.plugin(api, plugin.load.options, plugin.meta)
      return true
    })
    .catch((error) => {
      fail("failed to initialize tui plugin", {
        path: plugin.load.spec,
        id: plugin.id,
        error,
      })
      return false
    })

  if (!ok) {
    await scope.dispose()
    return false
  }

  if (!plugin.enabled) {
    await scope.dispose()
    return true
  }

  plugin.scope = scope
  return true
}

async function activatePluginById(state: RuntimeState | undefined, id: string, persist: boolean) {
  if (!state) return false
  const plugin = state.plugins_by_id.get(id)
  if (!plugin) return false
  return activatePluginEntry(state, plugin, persist)
}

async function deactivatePluginById(state: RuntimeState | undefined, id: string, persist: boolean) {
  if (!state) return false
  const plugin = state.plugins_by_id.get(id)
  if (!plugin) return false
  return deactivatePluginEntry(state, plugin, persist)
}

function pluginApi(runtime: RuntimeState, plugin: PluginEntry, scope: PluginScope, base: string): TuiPluginApi {
  const api = runtime.api
  const host = runtime.slots
  const load = plugin.load
  const command: TuiPluginApi["command"] = {
    register(cb) {
      return scope.track(api.command.register(cb))
    },
    trigger(value) {
      api.command.trigger(value)
    },
    show() {
      api.command.show()
    },
  }

  const route: TuiPluginApi["route"] = {
    register(list) {
      return scope.track(api.route.register(list))
    },
    navigate(name, params) {
      api.route.navigate(name, params)
    },
    get current() {
      return api.route.current
    },
  }

  const theme: TuiPluginApi["theme"] = Object.assign(Object.create(api.theme), {
    install: createThemeInstaller(load.origin, load.theme_root, load.spec, plugin),
  })

  const event: TuiPluginApi["event"] = {
    on(type, handler) {
      return scope.track(api.event.on(type, handler))
    },
  }

  let count = 0

  const slots: TuiPluginApi["slots"] = {
    register(plugin: TuiSlotPlugin) {
      const id = count ? `${base}:${count}` : base
      count += 1
      scope.track(host.register({ ...plugin, id }))
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
    event,
    renderer: api.renderer,
    slots,
    plugins: {
      list() {
        return listPluginStatus(runtime)
      },
      activate(id) {
        return activatePluginById(runtime, id, true)
      },
      deactivate(id) {
        return deactivatePluginById(runtime, id, true)
      },
      add(spec) {
        return addPluginBySpec(runtime, spec)
      },
      install(spec, options) {
        return installPluginBySpec(runtime, spec, options?.global)
      },
    },
    lifecycle: scope.lifecycle,
  }
}

function addPluginEntry(state: RuntimeState, plugin: PluginEntry) {
  if (state.plugins_by_id.has(plugin.id)) {
    fail("duplicate tui plugin id", {
      id: plugin.id,
      path: plugin.load.spec,
    })
    return false
  }

  state.plugins_by_id.set(plugin.id, plugin)
  state.plugins.push(plugin)
  return true
}

function applyInitialPluginEnabledState(state: RuntimeState, config: TuiConfig.Info) {
  const map = pluginEnabledState(state, config)
  for (const plugin of state.plugins) {
    const enabled = map[plugin.id]
    if (enabled === undefined) continue
    plugin.enabled = enabled
  }
}

async function resolveExternalPlugins(list: ConfigPlugin.Origin[], wait: () => Promise<void>) {
  return PluginLoader.loadExternal({
    items: list,
    kind: "tui",
    wait: async () => {
      await wait().catch((error) => {
        log.warn("failed waiting for tui plugin dependencies", { error })
      })
    },
    finish: async (loaded, origin, retry) => {
      const mod = await Promise.resolve()
        .then(() => readV1Plugin(loaded.mod as Record<string, unknown>, loaded.spec, "tui") as TuiPluginModule)
        .catch((error) => {
          fail("failed to load tui plugin", {
            path: loaded.spec,
            target: loaded.entry,
            retry,
            error,
          })
          return
        })
      if (!mod) return

      const id = await resolvePluginId(
        loaded.source,
        loaded.spec,
        loaded.target,
        readPluginId(mod.id, loaded.spec),
        loaded.pkg,
      ).catch((error) => {
        fail("failed to load tui plugin", { path: loaded.spec, target: loaded.target, retry, error })
        return
      })
      if (!id) return

      const theme_files = await readThemeFiles(loaded.spec, loaded.pkg)

      return {
        options: loaded.options,
        spec: loaded.spec,
        target: loaded.target,
        retry,
        source: loaded.source,
        id,
        module: mod,
        origin,
        theme_root: loaded.pkg?.dir ?? resolveRoot(loaded.target),
        theme_files,
      }
    },
    missing: async (loaded, origin, retry) => {
      const theme_files = await readThemeFiles(loaded.spec, loaded.pkg)
      if (!theme_files.length) return

      const name =
        typeof loaded.pkg?.json.name === "string" && loaded.pkg.json.name.trim().length > 0
          ? loaded.pkg.json.name.trim()
          : undefined
      const id = await resolvePluginId(loaded.source, loaded.spec, loaded.target, name, loaded.pkg).catch((error) => {
        fail("failed to load tui plugin", { path: loaded.spec, target: loaded.target, retry, error })
        return
      })
      if (!id) return

      return {
        options: loaded.options,
        spec: loaded.spec,
        target: loaded.target,
        retry,
        source: loaded.source,
        id,
        module: EMPTY_TUI,
        origin,
        theme_root: loaded.pkg?.dir ?? resolveRoot(loaded.target),
        theme_files,
      }
    },
    report: {
      start(candidate, retry) {
        log.info("loading tui plugin", { path: candidate.plan.spec, retry })
      },
      missing(candidate, retry, message) {
        warn("tui plugin has no entrypoint", { path: candidate.plan.spec, retry, message })
      },
      error(candidate, retry, stage, error, resolved) {
        const spec = candidate.plan.spec
        if (stage === "install") {
          fail("failed to resolve tui plugin", { path: spec, retry, error })
          return
        }
        if (stage === "compatibility") {
          fail("tui plugin incompatible", { path: spec, retry, error })
          return
        }
        if (stage === "entry") {
          fail("failed to resolve tui plugin entry", { path: spec, retry, error })
          return
        }
        fail("failed to load tui plugin", { path: spec, target: resolved?.entry, retry, error })
      },
    },
  })
}

async function addExternalPluginEntries(state: RuntimeState, ready: PluginLoad[]) {
  if (!ready.length) return { plugins: [] as PluginEntry[], ok: true }

  const meta = await PluginMeta.touchMany(
    ready.map((item) => ({
      spec: item.spec,
      target: item.target,
      id: item.id,
    })),
  ).catch((error) => {
    log.warn("failed to track tui plugins", { error })
    return undefined
  })

  const plugins: PluginEntry[] = []
  let ok = true
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

    const info = createMeta(entry.source, entry.spec, entry.target, hit, entry.id)
    const themes = hit?.entry.themes ? { ...hit.entry.themes } : {}
    const plugin: PluginEntry = {
      id: entry.id,
      load: entry,
      meta: info,
      themes,
      plugin: entry.module.tui,
      enabled: true,
    }
    if (!addPluginEntry(state, plugin)) {
      ok = false
      continue
    }
    plugins.push(plugin)
  }

  return { plugins, ok }
}

function defaultPluginOrigin(state: RuntimeState, spec: string): ConfigPlugin.Origin {
  return {
    spec,
    scope: "local",
    source: state.api.state.path.config || path.join(state.directory, ".opencode", "tui.json"),
  }
}

function installCause(err: unknown) {
  if (!err || typeof err !== "object") return
  if (!("cause" in err)) return
  return (err as { cause?: unknown }).cause
}

function installDetail(err: unknown) {
  const hit = installCause(err) ?? err
  if (!(hit instanceof Process.RunFailedError)) {
    return {
      message: errorMessage(hit),
      missing: false,
    }
  }

  const lines = hit.stderr
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const errs = lines.filter((line) => line.startsWith("error:")).map((line) => line.replace(/^error:\s*/, ""))
  return {
    message: errs[0] ?? lines.at(-1) ?? errorMessage(hit),
    missing: lines.some((line) => line.includes("No version matching")),
  }
}

async function addPluginBySpec(state: RuntimeState | undefined, raw: string) {
  if (!state) return false
  const spec = raw.trim()
  if (!spec) return false

  const cfg = state.pending.get(spec) ?? defaultPluginOrigin(state, spec)
  const next = ConfigPlugin.pluginSpecifier(cfg.spec)
  if (state.plugins.some((plugin) => plugin.load.spec === next)) {
    state.pending.delete(spec)
    return true
  }
  const ready = await resolveExternalPlugins([cfg], () => TuiConfig.waitForDependencies())
  if (!ready.length) {
    return false
  }

  const first = ready[0]
  if (!first) {
    fail("failed to add tui plugin", { path: next })
    return false
  }
  if (state.plugins_by_id.has(first.id)) {
    state.pending.delete(spec)
    return true
  }

  const out = await addExternalPluginEntries(state, [first])
  let ok = out.ok && out.plugins.length > 0
  for (const plugin of out.plugins) {
    const active = await activatePluginEntry(state, plugin, false)
    if (!active) ok = false
  }

  if (ok) state.pending.delete(spec)
  if (!ok) {
    fail("failed to add tui plugin", { path: next })
  }
  return ok
}

async function installPluginBySpec(
  state: RuntimeState | undefined,
  raw: string,
  global = false,
): Promise<TuiPluginInstallResult> {
  if (!state) {
    return {
      ok: false,
      message: "Plugin runtime is not ready.",
    }
  }

  const spec = raw.trim()
  if (!spec) {
    return {
      ok: false,
      message: "Plugin package name is required",
    }
  }

  const dir = state.api.state.path
  if (!dir.directory) {
    return {
      ok: false,
      message: "Paths are still syncing. Try again in a moment.",
    }
  }

  const install = await installModulePlugin(spec)
  if (!install.ok) {
    const out = installDetail(install.error)
    return {
      ok: false,
      message: out.message,
      missing: out.missing,
    }
  }

  const manifest = await readPluginManifest(install.target)
  if (!manifest.ok) {
    if (manifest.code === "manifest_no_targets") {
      return {
        ok: false,
        message: `"${spec}" does not expose plugin entrypoints or oc-themes in package.json`,
      }
    }

    return {
      ok: false,
      message: `Installed "${spec}" but failed to read ${manifest.file}`,
    }
  }

  const patch = await patchPluginConfig({
    spec,
    targets: manifest.targets,
    global,
    vcs: dir.worktree && dir.worktree !== "/" ? "git" : undefined,
    worktree: dir.worktree,
    directory: dir.directory,
  })
  if (!patch.ok) {
    if (patch.code === "invalid_json") {
      return {
        ok: false,
        message: `Invalid JSON in ${patch.file} (${patch.parse} at line ${patch.line}, column ${patch.col})`,
      }
    }

    return {
      ok: false,
      message: errorMessage(patch.error),
    }
  }

  const tui = manifest.targets.find((item) => item.kind === "tui")
  if (tui) {
    const file = patch.items.find((item) => item.kind === "tui")?.file
    const next = tui.opts ? ([spec, tui.opts] as ConfigPlugin.Spec) : spec
    state.pending.set(spec, {
      spec: next,
      scope: global ? "global" : "local",
      source: (file ?? dir.config) || path.join(patch.dir, "tui.json"),
    })
  }

  return {
    ok: true,
    dir: patch.dir,
    tui: Boolean(tui),
  }
}

export namespace TuiPluginRuntime {
  let dir = ""
  let loaded: Promise<void> | undefined
  let runtime: RuntimeState | undefined
  export const Slot = View

  export async function init(input: { api: HostPluginApi; config: TuiConfig.Info }) {
    const cwd = process.cwd()
    if (loaded) {
      if (dir !== cwd) {
        throw new Error(`TuiPluginRuntime.init() called with a different working directory. expected=${dir} got=${cwd}`)
      }
      return loaded
    }

    dir = cwd
    loaded = load(input)
    return loaded
  }

  export function list() {
    if (!runtime) return []
    return listPluginStatus(runtime)
  }

  export async function activatePlugin(id: string) {
    return activatePluginById(runtime, id, true)
  }

  export async function deactivatePlugin(id: string) {
    return deactivatePluginById(runtime, id, true)
  }

  export async function addPlugin(spec: string) {
    return addPluginBySpec(runtime, spec)
  }

  export async function installPlugin(spec: string, options?: { global?: boolean }) {
    return installPluginBySpec(runtime, spec, options?.global)
  }

  export async function dispose() {
    const task = loaded
    loaded = undefined
    dir = ""
    if (task) await task
    const state = runtime
    runtime = undefined
    if (!state) return
    const queue = [...state.plugins].reverse()
    for (const plugin of queue) {
      await deactivatePluginEntry(state, plugin, false)
    }
  }

  async function load(input: { api: Api; config: TuiConfig.Info }) {
    const { api, config } = input
    const cwd = process.cwd()
    const slots = setupSlots(api)
    const next: RuntimeState = {
      directory: cwd,
      api,
      slots,
      plugins: [],
      plugins_by_id: new Map(),
      pending: new Map(),
    }
    runtime = next
    try {
      const records = Flag.OPENCODE_PURE ? [] : (config.plugin_origins ?? [])
      if (Flag.OPENCODE_PURE && config.plugin_origins?.length) {
        log.info("skipping external tui plugins in pure mode", { count: config.plugin_origins.length })
      }

      for (const item of INTERNAL_TUI_PLUGINS) {
        log.info("loading internal tui plugin", { id: item.id })
        const entry = loadInternalPlugin(item)
        const meta = createMeta(entry.source, entry.spec, entry.target, undefined, entry.id)
        addPluginEntry(next, {
          id: entry.id,
          load: entry,
          meta,
          themes: {},
          plugin: entry.module.tui,
          enabled: true,
        })
      }

      const ready = await resolveExternalPlugins(records, () => TuiConfig.waitForDependencies())
      await addExternalPluginEntries(next, ready)

      applyInitialPluginEnabledState(next, config)
      for (const plugin of next.plugins) {
        if (!plugin.enabled) continue
        // Keep plugin execution sequential for deterministic side effects:
        // command registration order affects keybind/command precedence,
        // route registration is last-wins when ids collide,
        // and hook chains rely on stable plugin ordering.
        await activatePluginEntry(next, plugin, false)
      }
    } catch (error) {
      fail("failed to load tui plugins", { directory: cwd, error })
    }
  }
}
