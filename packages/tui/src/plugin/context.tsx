import type { Plugin } from "@opencode-ai/plugin/tui"
import {
  batch,
  createComponent,
  createContext,
  createEffect,
  createMemo,
  ErrorBoundary,
  For,
  mergeProps,
  on,
  onCleanup,
  onMount,
  Show,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import path from "path"
import { watch } from "fs"
import { stat } from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import type { Page, Slot, SlotMap, SlotName } from "@opencode-ai/plugin/tui/context"
import { createStore, produce, reconcile as reconcileStore } from "solid-js/store"
import { isDeepEqual } from "remeda"
import "#runtime-plugin-support"
import { useConfig } from "../config"
import { useRoute } from "../context/route"
import { useTuiLifecycle } from "../context/runtime"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { builtins } from "./builtins"
import { createPluginContext, usePluginHost, type Dispose } from "./api"
import { discoverTuiPlugins, freshSpecifier, localSource, tuiPluginDirectory } from "./discovery"

export interface PackageResolver {
  readonly resolve: (spec: string) => Promise<string | undefined>
}

type State =
  | { readonly target: string; readonly id: string; readonly status: "active" | "inactive" }
  | { readonly target: string; readonly status: "unsupported" }
  | { readonly target: string; readonly status: "failed"; readonly error: string }

type RegisteredPlugin = {
  readonly id: string
  readonly source: "builtin" | "external"
  readonly active: boolean
}

type Value = {
  readonly ready: () => boolean
  readonly list: () => ReadonlyArray<State>
  readonly registered: () => ReadonlyArray<RegisteredPlugin>
  readonly route: (id: string, name: string) => Page["render"] | undefined
  readonly slot: <Name extends SlotName>(name: Name) => ReadonlyArray<{ readonly id: string; readonly render: Slot<Name> }>
  readonly activate: (id: string) => Promise<boolean>
  readonly deactivate: (id: string) => Promise<boolean>
}

type Registration = {
  plugin: Plugin.Definition
  source: RegisteredPlugin["source"]
  target?: string
  version: string
  options?: Readonly<Record<string, any>>
  active: boolean
  routes: Record<string, Page>
  slots: Record<string, Slot>
  cleanups: Dispose[]
}

// One entry of the desired plugin generation produced by the resolve phase.
type Desired = Pick<Registration, "plugin" | "source" | "target" | "version" | "options"> & { enabled: boolean }

const PluginContext = createContext<Value>()

export function PluginProvider(props: ParentProps<{ packages: PackageResolver }>) {
  const host = usePluginHost()
  const config = useConfig()
  const lifecycle = useTuiLifecycle()
  const directory = config.path ? path.dirname(config.path) : process.cwd()
  const [store, setStore] = createStore({
    ready: false,
    states: [] as ReadonlyArray<State>,
    registrations: {} as Record<string, Registration>,
  })

  const activate = async (id: string) => {
    const item = store.registrations[id]
    if (!item) return false
    await deactivate(id)
    batch(() => {
      setStore("registrations", id, "routes", reconcileStore({}))
      setStore("registrations", id, "slots", reconcileStore({}))
      setStore("registrations", id, "cleanups", [])
    })
    const owned: Dispose[] = []
    const context = createPluginContext({
      host,
      id,
      options: item.options,
      owned,
      registry: {
        has: (kind, name) => Boolean(store.registrations[id]?.[kind][name]),
        set: (kind: "routes" | "slots", name: string, value: Page | Slot) =>
          setStore("registrations", id, kind, name, () => value),
        remove: (kind, name) =>
          setStore(
            "registrations",
            produce((registrations) => {
              if (!registrations[id]) return
              delete registrations[id][kind][name]
            }),
          ),
        active: () => Boolean(store.registrations[id]?.active),
      },
    })
    const cleanup = await setup(item.plugin, context, owned).catch((error) => {
      setStore("registrations", id, "routes", reconcileStore({}))
      setStore("registrations", id, "slots", reconcileStore({}))
      throw error
    })
    if (cleanup) owned.push(async () => cleanup())
    batch(() => {
      setStore("registrations", id, "cleanups", owned)
      setStore("registrations", id, "active", true)
      setStore("states", (items) =>
        items.map((state) =>
          "id" in state && state.id === id ? { target: state.target, id, status: "active" } : state,
        ),
      )
    })
    return true
  }

  const deactivate = async (id: string) => {
    const item = store.registrations[id]
    if (!item?.active) return false
    const cleanups = [...item.cleanups]
    batch(() => {
      setStore("registrations", id, "active", false)
      setStore("registrations", id, "cleanups", [])
    })
    await disposeAll(cleanups).finally(() =>
      batch(() => {
        if (store.registrations[id]) {
          setStore("registrations", id, "routes", reconcileStore({}))
          setStore("registrations", id, "slots", reconcileStore({}))
        }
        setStore("states", (items) =>
          items.map((state) =>
            "id" in state && state.id === id ? { target: state.target, id, status: "inactive" } : state,
          ),
        )
      }),
    )
    return true
  }

  // Hot-reload local plugin sources: watch the discovery directory and any
  // local entrypoints, then rebuild the plugin generation when one changes.
  // Files are watched through their parent directory (editors that save by
  // rename replace the inode, which silently kills a direct file watch) and
  // filtered by basename so bursts in busy directories stay quiet. Directory
  // plugins are watched at their root only: edits to nested helper files do
  // not change the entrypoint mtime and are not detected. Watches are never
  // torn down individually (a stale watch costs one fs handle and a no-op
  // reconcile); all die with this provider. Failed watches are forgotten so
  // a later reconcile can re-arm once the path exists.
  const watchers = new Set<ReturnType<typeof watch>>()
  const watched = new Map<string, Set<string> | null>()
  let disposed = false
  let pending: ReturnType<typeof setTimeout> | undefined
  const scheduleReconcile = () => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      loading = loading.catch(() => undefined).then(() => reconcile())
      // Observe failures immediately: a plugin cleanup that throws would
      // otherwise surface as an unhandled rejection until the next trigger.
      void loading.catch(() => undefined)
    }, 100)
  }
  const watchSource = (target: string) => {
    stat(target)
      .then((info) => {
        if (disposed) return
        const dir = info.isDirectory() ? target : path.dirname(target)
        // Directories accept every filename (null); files accept their basename.
        const name = info.isDirectory() ? null : path.basename(target)
        const existing = watched.get(dir)
        if (existing !== undefined) {
          if (name === null) watched.set(dir, null)
          else existing?.add(name)
          return
        }
        watched.set(dir, name === null ? null : new Set([name]))
        const watcher = watch(dir, (_event, filename) => {
          // A null filename (platform-dependent) always schedules.
          const accept = watched.get(dir)
          if (filename && accept && !accept.has(filename.toString())) return
          scheduleReconcile()
        })
        // A watched directory can disappear out from under us; without a
        // listener the error event would crash the process. Forget the path
        // so a later reconcile can re-arm once it exists again.
        watcher.on("error", () => {
          watcher.close()
          watchers.delete(watcher)
          watched.delete(dir)
        })
        watchers.add(watcher)
      })
      .catch(() => undefined)
  }
  onCleanup(() => {
    disposed = true
    clearTimeout(pending)
    for (const watcher of watchers) watcher.close()
  })

  // Rebuild the plugin generation as resolve → compare → swap, mirroring the
  // core plugin registry: fold the ordered entries into a desired end state
  // (importing only new or changed sources, before anything running is
  // touched), no-op when the generation is unchanged, and restart only the
  // plugins that differ. Membership or order changes rebuild the whole
  // generation to preserve slot-order semantics.
  // Package resolution failures would otherwise retry a full npm install on
  // every watch event; remember them until the configuration changes.
  const npmFailures = new Map<string, string>()
  const reconcile = async () => {
    const entries = [...(await discoverTuiPlugins(host.paths.cwd)), ...(config.data.plugins ?? [])]
    watchSource(tuiPluginDirectory(host.paths.cwd))

    // Resolve: fold entries into one desired generation. A source that fails
    // to import keeps its running previous version and only reports failure.
    const desired = new Map<string, Desired>()
    for (const plugin of builtins) desired.set(plugin.id, { plugin, source: "builtin", version: "builtin", enabled: true })
    const failures: State[] = []
    for (const entry of entries) {
      const target = typeof entry === "string" ? entry : entry.package
      if (target.startsWith("-")) {
        for (const item of desired.values()) if (matches(target.slice(1), item.plugin.id)) item.enabled = false
        continue
      }

      const selected = [...desired.values()].filter((item) => matches(target, item.plugin.id))
      if (selected.length || target === "*" || target.endsWith(".*") || target.startsWith("opencode.")) {
        for (const item of selected) item.enabled = true
        continue
      }

      const options = typeof entry === "string" ? undefined : entry.options
      // Watch even when the resolve below fails so fixing a broken plugin reloads it.
      const local = localSource(target, directory)
      if (local) watchSource(fileURLToPath(local))
      const previous = Object.values(store.registrations).find((registration) => registration.target === target)
      const memo = local ? undefined : npmFailures.get(target)
      const resolved = memo
        ? { status: "failed" as const, error: memo }
        : await resolvePlugin(target, local, options, previous, props.packages).catch((error) => ({
            status: "failed" as const,
            error: errorMessage(error),
          }))
      if (resolved.status === "unsupported") {
        failures.push({ target, status: "unsupported" })
        continue
      }
      if (resolved.status === "failed") {
        if (!local && !previous) npmFailures.set(target, resolved.error)
        failures.push({
          target,
          status: "failed",
          error: previous?.active ? `${resolved.error} (previous version still active)` : resolved.error,
        })
        if (previous)
          desired.set(previous.plugin.id, {
            plugin: previous.plugin,
            source: previous.source,
            target,
            version: previous.version,
            options: previous.options,
            enabled: previous.active,
          })
        continue
      }
      desired.set(resolved.plugin.id, {
        plugin: resolved.plugin,
        source: "external",
        target,
        version: resolved.version,
        options,
        enabled: true,
      })
    }

    // Compare: unchanged plugins are never touched, and a fully unchanged
    // generation is a no-op, so spurious watch events cost nothing.
    const currentIds = Object.keys(store.registrations)
    const desiredIds = [...desired.keys()]
    const structural = currentIds.length !== desiredIds.length || currentIds.some((id, index) => desiredIds[index] !== id)
    if (structural) {
      await Promise.all(
        Object.entries(store.registrations)
          .filter(([, registration]) => registration.active)
          .map(([id]) => deactivate(id).catch(() => undefined)),
      )
      setStore("registrations", reconcileStore({}))
    }
    const changed = structural
      ? desiredIds
      : desiredIds.filter((id) => {
          const registration = store.registrations[id]!
          const item = desired.get(id)!
          // enabled derives from config directives alone, so config wins over
          // manual dialog toggles on every reconcile — the same semantics
          // config saves had before hot reload existed, just more frequent.
          return (
            registration.version !== item.version ||
            !sameOptions(registration.options, item.options) ||
            registration.active !== item.enabled
          )
        })

    // Swap: cleanup failures are logged into states, never propagated, so one
    // broken plugin cannot take the rest of the generation down.
    const errors = new Map<string, string>()
    for (const id of changed) {
      const item = desired.get(id)!
      const registration = store.registrations[id]
      if (!registration || registration.version !== item.version || !sameOptions(registration.options, item.options)) {
        if (registration) await deactivate(id).catch(() => undefined)
        // In-place replacement keeps the registration's key position, which
        // slot ordering (mode "replace" takes the last one) depends on.
        setStore("registrations", id, toRegistration(item))
      }
      if (!item.enabled) {
        await deactivate(id).catch(() => undefined)
        continue
      }
      const error = await activate(id).then(() => undefined, errorMessage)
      if (error) errors.set(id, error)
    }

    const failedTargets = new Set(failures.map((failure) => failure.target))
    const states: State[] = [
      ...[...desired.values()].flatMap((item): State[] => {
        if (item.target === undefined) return []
        // A failed reload keeps this item running; the failure entry covers it.
        if (failedTargets.has(item.target)) return []
        const error = errors.get(item.plugin.id)
        if (error) return [{ target: item.target, status: "failed", error }]
        const status = store.registrations[item.plugin.id]?.active ? "active" : "inactive"
        return [{ target: item.target, id: item.plugin.id, status }]
      }),
      ...failures,
    ]
    // Surface newly failing plugins; repeated reconciles stay silent.
    for (const state of states)
      if (
        state.status === "failed" &&
        !store.states.some((prev) => prev.status === "failed" && prev.target === state.target && prev.error === state.error)
      )
        host.toast.show({ variant: "error", title: "Plugin", message: `${state.target}: ${state.error}` })
    setStore("states", reconcileStore(states))
  }
  const slotItems = new WeakMap<Slot, { readonly id: string; readonly render: Slot }>()
  let loading = Promise.resolve()
  createEffect(
    on(
      () => JSON.stringify(config.data.plugins ?? []),
      () => {
        npmFailures.clear()
        loading = loading.catch(() => undefined).then(() => reconcile())
        void loading.then(
          () => setStore("ready", true),
          () => setStore("ready", true),
        )
      },
    ),
  )
  onMount(() => {
    let disposing: Promise<void> | undefined
    const dispose = () => {
      if (disposing) return disposing
      disposing = loading
        .catch(() => undefined)
        .then(() =>
          Promise.all(
            Object.entries(store.registrations)
              .filter(([, registration]) => registration.active)
              .map(([id]) => deactivate(id).catch(() => undefined)),
          ),
        )
        .then(() => setStore("registrations", reconcileStore({})))
      return disposing
    }
    const unregister = lifecycle.add(dispose)
    onCleanup(() => {
      unregister()
      void dispose()
    })
  })

  return (
    <PluginContext.Provider
      value={{
        ready: () => store.ready,
        list: () => store.states,
        registered: () =>
          Object.entries(store.registrations).map(([id, plugin]) => ({ id, source: plugin.source, active: plugin.active })),
        route: (id, name) => store.registrations[id]?.routes[name]?.render,
        slot: (name) =>
          Object.entries(store.registrations).flatMap(([id, registration]) => {
            const render = registration.active ? registration.slots[name] : undefined
            if (!render) return []
            // <For> diffs rows by reference; a stable wrapper per render
            // function keeps untouched plugins' slot rows (and their state)
            // alive across other plugins' reloads.
            const cached = slotItems.get(render)
            if (cached) return [cached]
            const item = { id, render }
            slotItems.set(render, item)
            return [item]
          }),
        activate,
        deactivate,
      }}
    >
      {props.children}
    </PluginContext.Provider>
  )
}

async function disposeAll(cleanups: Dispose[]) {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch((error) => failures.push(error))
  if (failures.length) throw failures[0]
}

async function setup(plugin: Plugin.Definition, context: Plugin.Context, owned: Dispose[]) {
  try {
    return await plugin.setup(context)
  } catch (error) {
    await disposeAll(owned).catch(() => undefined)
    throw error
  }
}

function matches(selector: string, id: string) {
  return selector === "*" || selector === id || (selector.endsWith(".*") && id.startsWith(selector.slice(0, -1)))
}

async function resolvePlugin(
  spec: string,
  local: URL | undefined,
  options: Readonly<Record<string, any>> | undefined,
  previous: Registration | undefined,
  packages: PackageResolver,
) {
  // Package entrypoints never change within a session, so a loaded previous
  // version needs no re-resolution (which could otherwise hit npm).
  if (!local && previous && sameOptions(previous.options, options))
    return { status: "unchanged" as const, plugin: previous.plugin, version: previous.version }
  const entrypoint = local ? await resolveLocal(local) : await packages.resolve(spec)
  if (!entrypoint) return { status: "unsupported" as const }
  // The cache-busted specifier doubles as the version: unique per entrypoint
  // and mtime, so equal versions mean an identical module.
  const version = local ? freshSpecifier(entrypoint, (await stat(new URL(entrypoint))).mtimeMs) : entrypoint
  if (previous && previous.version === version && sameOptions(previous.options, options))
    return { status: "unchanged" as const, plugin: previous.plugin, version }
  const mod: { readonly default?: unknown } = await import(version)
  if (!isPlugin(mod.default)) throw new Error(`Invalid V2 TUI plugin module: ${spec}`)
  return { status: "loaded" as const, plugin: mod.default, version }
}

function toRegistration(item: Desired): Registration {
  return {
    plugin: item.plugin,
    source: item.source,
    target: item.target,
    version: item.version,
    options: item.options,
    active: false,
    routes: {},
    slots: {},
    cleanups: [],
  }
}

function sameOptions(a: Registration["options"], b: Registration["options"]) {
  return isDeepEqual(a ?? null, b ?? null)
}

async function resolveLocal(url: URL) {
  const info = await stat(url)
  if (info.isFile()) return url.href
  if (!info.isDirectory()) return
  return resolve(pathToFileURL(path.join(fileURLToPath(url), "tui")).href)
}

function resolve(specifier: string) {
  try {
    return import.meta.resolve(specifier)
  } catch {
    return undefined
  }
}

function isPlugin(value: unknown): value is Plugin.Definition {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "setup" in value &&
    typeof value.setup === "function"
  )
}

export function usePlugin() {
  const value = useContext(PluginContext)
  if (!value) throw new Error("PluginProvider is missing")
  return value
}

// Contain render-time plugin crashes: a throwing slot or route must not take
// down the app or the other plugins. The crash surfaces as one error toast.
function PluginBoundary(props: ParentProps<{ id: string; where: string }>) {
  const toast = useToast()
  return (
    <ErrorBoundary
      fallback={(error) => {
        // One toast per crash: onMount is untracked, so prop updates while
        // the boundary is latched cannot re-toast.
        onMount(() =>
          toast.show({
            variant: "error",
            title: "Plugin",
            message: `${props.id} crashed in ${props.where}: ${errorMessage(error)}`,
          }),
        )
        return null
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}

export function PluginRoute(props: { readonly fallback: (id: string, name: string) => JSX.Element }) {
  const plugins = usePlugin()
  const route = useRoute()
  const current = createMemo(() => {
    if (route.data.type !== "plugin") return
    return {
      id: route.data.id,
      name: route.data.name,
      render: plugins.route(route.data.id, route.data.name),
      data: route.data.data,
    }
  })
  return (
    // Keyed so navigation or a hot reload recreates the boundary; otherwise
    // one crash would latch every future plugin route into the fallback.
    <Show keyed when={current()}>
      {(item) => (
        <PluginBoundary id={item.id} where="route">
          {item.render ? createComponent(item.render, { data: item.data }) : props.fallback(item.id, item.name)}
        </PluginBoundary>
      )}
    </Show>
  )
}

export function PluginSlot<Name extends SlotName>(props: {
  readonly name: Name
  readonly input: SlotMap[Name]
  readonly mode: "all" | "replace"
}) {
  const plugins = usePlugin()
  const renderers = createMemo(() => {
    const items = plugins.slot(props.name)
    if (props.mode === "replace") return items.slice(-1)
    return items
  })
  return (
    <For each={renderers()}>
      {(item) => (
        <PluginBoundary id={item.id} where={`slot ${props.name}`}>
          {
            // Component semantics: the render body runs once and untracked, so
            // signals and intervals created inside are stable, while props stay
            // reactive through the merged getter. A bare item.render(props.input)
            // call would run inside the host's tracked scope and re-execute the
            // whole body (resetting plugin state) on every tracked read.
            createComponent(item.render, mergeProps(() => props.input) as SlotMap[Name])
          }
        </PluginBoundary>
      )}
    </For>
  )
}
