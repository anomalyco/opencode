import "@opentui/solid/runtime-plugin-support"
import {
  type TuiDispose,
  type TuiPlugin,
  type TuiPluginApi,
  type TuiPluginInstallResult,
  type TuiPluginModule,
  type TuiPluginMeta,
  type TuiPluginStatus,
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
import {
  checkPluginCompatibility,
  isDeprecatedPlugin,
  pluginSource,
  readPluginId,
  readV1Plugin,
  resolvePluginEntrypoint,
  resolvePluginId,
  resolvePluginTarget,
  type PluginSource,
} from "@/plugin/shared"
import { PluginMeta } from "@/plugin/meta"
import { installPlugin as installModulePlugin, patchPluginConfig, readPluginManifest } from "@/plugin/install"
import { addTheme, hasTheme } from "../context/theme"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { INTERNAL_TUI_PLUGINS, type InternalTuiPlugin } from "./internal"
import { setupSlots, Slot as View } from "./slots"
import type { HostPluginApi, HostSlots } from "./slots"

type PluginLoad = {
  item?: Config.PluginSpec
  spec: string
  target: string
  retry: boolean
  source: PluginSource | "internal"
  id: string
  module: TuiPluginModule
  install_theme: TuiTheme["install"]
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
  plugin: TuiPlugin
  options: Config.PluginOptions | undefined
  enabled: boolean
  scope?: PluginScope
}

type RuntimeState = {
  directory: string
  api: Api
  slots: HostSlots
  plugins: PluginEntry[]
  plugins_by_id: Map<string, PluginEntry>
  pending: Map<
    string,
    {
      item: Config.PluginSpec
      meta: TuiConfig.PluginMeta
    }
  >
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

function createThemeInstaller(meta: TuiConfig.PluginMeta, root: string, spec: string): TuiTheme["install"] {
  return async (file) => {
    const raw = file.startsWith("file://") ? fileURLToPath(file) : file
    const src = path.isAbsolute(raw) ? raw : path.resolve(root, raw)
    const theme = path.basename(src, path.extname(src))
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

    const source_dir = path.dirname(meta.source)
    const local_dir =
      path.basename(source_dir) === ".opencode"
        ? path.join(source_dir, "themes")
        : path.join(source_dir, ".opencode", "themes")
    const dest_dir = meta.scope === "local" ? local_dir : path.join(Global.Path.config, "themes")
    const dest = path.join(dest_dir, `${theme}.json`)
    if (!(await Filesystem.exists(dest))) {
      await Filesystem.write(dest, text).catch((error) => {
        log.warn("failed to persist tui plugin theme", { path: spec, theme: src, dest, error })
      })
    }

    addTheme(theme, data)
  }
}

async function loadExternalPlugin(
  item: Config.PluginSpec,
  meta: TuiConfig.PluginMeta | undefined,
  retry = false,
): Promise<PluginLoad | undefined> {
  const spec = Config.pluginSpecifier(item)
  if (isDeprecatedPlugin(spec)) return
  log.info("loading tui plugin", { path: spec, retry })
  const resolved = await resolvePluginTarget(spec).catch((error) => {
    fail("failed to resolve tui plugin", { path: spec, retry, error })
    return
  })
  if (!resolved) return

  const source = pluginSource(spec)
  if (source === "npm") {
    const ok = await checkPluginCompatibility(resolved, Installation.VERSION)
      .then(() => true)
      .catch((error) => {
        fail("tui plugin incompatible", { path: spec, retry, error })
        return false
      })
    if (!ok) return
  }

  const target = resolved
  if (!meta) {
    fail("missing tui plugin metadata", {
      path: spec,
      retry,
    })
    return
  }

  const root = resolveRoot(source === "file" ? spec : target)
  const install_theme = createThemeInstaller(meta, root, spec)
  const entry = await resolvePluginEntrypoint(spec, target, "tui").catch((error) => {
    fail("failed to resolve tui plugin entry", { path: spec, target, retry, error })
    return
  })
  if (!entry) return

  const mod = await import(entry)
    .then((raw) => {
      return readV1Plugin(raw as Record<string, unknown>, spec, "tui") as TuiPluginModule
    })
    .catch((error) => {
      fail("failed to load tui plugin", { path: spec, target: entry, retry, error })
      return
    })
  if (!mod) return

  const id = await resolvePluginId(source, spec, target, readPluginId(mod.id, spec)).catch((error) => {
    fail("failed to load tui plugin", { path: spec, target, retry, error })
    return
  })
  if (!id) return

  return {
    item,
    spec,
    target,
    retry,
    source,
    id,
    module: mod,
    install_theme,
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
    spec,
    target,
    retry: false,
    source: "internal",
    id: item.id,
    module: item,
    install_theme: createThemeInstaller(
      {
        scope: "global",
        source: target,
      },
      process.cwd(),
      spec,
    ),
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
  const api = pluginApi(state, plugin.load, scope, plugin.id)
  const ok = await Promise.resolve()
    .then(async () => {
      await plugin.plugin(api, plugin.options, plugin.meta)
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

function pluginApi(runtime: RuntimeState, load: PluginLoad, scope: PluginScope, base: string): TuiPluginApi {
  const api = runtime.api
  const host = runtime.slots
  const command: TuiPluginApi["command"] = {
    register(cb) {
      return scope.track(api.command.register(cb))
    },
    trigger(value) {
      api.command.trigger(value)
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
    install: load.install_theme,
  })

  const event: TuiPluginApi["event"] = {
    on(type, handler) {
      return scope.track(api.event.on(type, handler))
    },
  }

  let count = 0

  const slots: TuiPluginApi["slots"] = {
    register(plugin) {
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
    scopedClient: api.scopedClient,
    workspace: api.workspace,
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

function collectPluginEntries(load: PluginLoad, meta: TuiPluginMeta) {
  const options = load.item ? Config.pluginOptions(load.item) : undefined
  return [
    {
      id: load.id,
      load,
      meta,
      plugin: load.module.tui,
      options,
      enabled: true,
    },
  ]
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

async function resolveExternalPlugins(
  list: Config.PluginSpec[],
  wait: () => Promise<void>,
  meta: (item: Config.PluginSpec) => TuiConfig.PluginMeta | undefined,
) {
  const loaded = await Promise.all(list.map((item) => loadExternalPlugin(item, meta(item))))
  const ready: PluginLoad[] = []
  let deps: Promise<void> | undefined

  for (let i = 0; i < list.length; i++) {
    let entry = loaded[i]
    if (!entry) {
      const item = list[i]
      if (!item) continue
      const spec = Config.pluginSpecifier(item)
      if (pluginSource(spec) !== "file") continue
      deps ??= wait().catch((error) => {
        log.warn("failed waiting for tui plugin dependencies", { error })
      })
      await deps
      entry = await loadExternalPlugin(item, meta(item), true)
    }
    if (!entry) continue
    ready.push(entry)
  }

  return ready
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

    const row = createMeta(entry.source, entry.spec, entry.target, hit, entry.id)
    for (const plugin of collectPluginEntries(entry, row)) {
      if (!addPluginEntry(state, plugin)) {
        ok = false
        continue
      }
      plugins.push(plugin)
    }
  }

  return { plugins, ok }
}

function defaultPluginMeta(state: RuntimeState): TuiConfig.PluginMeta {
  return {
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

  const pending = state.pending.get(spec)
  const item = pending?.item ?? spec
  const nextSpec = Config.pluginSpecifier(item)
  if (state.plugins.some((plugin) => plugin.load.spec === nextSpec)) {
    state.pending.delete(spec)
    return true
  }

  const meta = pending?.meta ?? defaultPluginMeta(state)

  const ready = await Instance.provide({
    directory: state.directory,
    fn: () =>
      resolveExternalPlugins(
        [item],
        () => TuiConfig.waitForDependencies(),
        () => meta,
      ),
  }).catch((error) => {
    fail("failed to add tui plugin", { path: nextSpec, error })
    return [] as PluginLoad[]
  })
  if (!ready.length) {
    fail("failed to add tui plugin", { path: nextSpec })
    return false
  }

  const first = ready[0]
  if (!first) {
    fail("failed to add tui plugin", { path: nextSpec })
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
    fail("failed to add tui plugin", { path: nextSpec })
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
        message: `"${spec}" does not declare supported targets in package.json`,
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
    state.pending.set(spec, {
      item: tui.opts ? [spec, tui.opts] : spec,
      meta: {
        scope: global ? "global" : "local",
        source: (file ?? dir.config) || path.join(patch.dir, "tui.json"),
      },
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

  async function load(api: Api) {
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

    await Instance.provide({
      directory: cwd,
      fn: async () => {
        const config = await TuiConfig.get()
        const plugins = Flag.OPENCODE_PURE ? [] : (config.plugin ?? [])
        if (Flag.OPENCODE_PURE && config.plugin?.length) {
          log.info("skipping external tui plugins in pure mode", { count: config.plugin.length })
        }

        for (const item of INTERNAL_TUI_PLUGINS) {
          log.info("loading internal tui plugin", { id: item.id })
          const entry = loadInternalPlugin(item)
          const meta = createMeta(entry.source, entry.spec, entry.target, undefined, entry.id)
          for (const plugin of collectPluginEntries(entry, meta)) {
            addPluginEntry(next, plugin)
          }
        }

        const ready = await resolveExternalPlugins(
          plugins,
          () => TuiConfig.waitForDependencies(),
          (item) => config.plugin_meta?.[Config.pluginSpecifier(item)],
        )
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
      },
    }).catch((error) => {
      fail("failed to load tui plugins", { directory: cwd, error })
    })
  }
}
