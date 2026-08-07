import type { Plugin } from "@opencode-ai/plugin/tui"
import { batch, createEffect, on, onCleanup, onMount, type ParentProps } from "solid-js"
import path from "path"
import { stat } from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import type { Page, Slot } from "@opencode-ai/plugin/tui/context"
import { createStore, produce, reconcile as reconcileStore } from "solid-js/store"
import { isDeepEqual } from "remeda"
import "#runtime-plugin-support"
import { useConfig } from "../config"
import { useTuiLifecycle } from "../context/runtime"
import { errorMessage } from "../util/error"
import { builtins } from "./builtins"
import { createPluginContext, usePluginHost, type Dispose } from "./api"
import { createSourceWatcher } from "./watch"
import { discoverTuiPlugins, freshSpecifier, localSource } from "./discovery"
import { PluginContext, type PluginState, type RegisteredPlugin } from "./use-plugin"

export interface PackageResolver {
  readonly resolve: (spec: string) => Promise<string | undefined>
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

export function PluginProvider(props: ParentProps<{ packages: PackageResolver; directories: string[] }>) {
  const host = usePluginHost()
  const config = useConfig()
  const lifecycle = useTuiLifecycle()
  const directory = config.path ? path.dirname(config.path) : process.cwd()
  const [store, setStore] = createStore({
    ready: false,
    states: [] as ReadonlyArray<PluginState>,
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

  // Cleanup failures must not stop a swap or teardown, but they should not
  // vanish either: the old generation may still own listeners or intervals.
  const deactivateNoisily = (id: string) =>
    deactivate(id).catch((error) =>
      host.toast.show({ variant: "error", title: "Plugin", message: `${id}: cleanup failed: ${errorMessage(error)}` }),
    )

  // Every lifecycle mutation — reconciles, manual dialog toggles, shutdown —
  // is serialized through one chain so generations can never interleave.
  let loading = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>) => {
    const result = loading.catch(() => undefined).then(task)
    loading = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  // Hot-reload local plugin sources: watch the discovery directory and any
  // local entrypoints (see watch.ts for the mechanics), debounced into a
  // serialized reconcile so bursts of events rebuild the generation once.
  let pending: ReturnType<typeof setTimeout> | undefined
  const watcher = createSourceWatcher(() => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      // Observe failures immediately: a plugin cleanup that throws would
      // otherwise surface as an unhandled rejection until the next trigger.
      void enqueue(reconcile).catch(() => undefined)
    }, 100)
  })
  const stopWatching = () => {
    clearTimeout(pending)
    watcher.dispose()
  }
  onCleanup(stopWatching)

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
    await Promise.all(props.directories.map(watcher.wait))
    const entries = [...(await discoverTuiPlugins(props.directories)), ...(config.data.plugins ?? [])]

    // Resolve: fold entries into one desired generation. A source that fails
    // to import keeps its running previous version and only reports failure.
    const desired = new Map<string, Desired>()
    for (const plugin of builtins) desired.set(plugin.id, { plugin, source: "builtin", version: "builtin", enabled: true })
    const failures: PluginState[] = []
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
      if (local) await watcher.add(fileURLToPath(local))
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
          .map(([id]) => deactivateNoisily(id)),
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

    // Swap: cleanup failures surface as a toast, never propagate, so one
    // broken plugin cannot take the rest of the generation down.
    const errors = new Map<string, string>()
    for (const id of changed) {
      const item = desired.get(id)!
      const registration = store.registrations[id]
      const replaced =
        !registration || registration.version !== item.version || !sameOptions(registration.options, item.options)
      // Snapshot the running version before it is overwritten: an import
      // failure keeps last-good in the resolve phase, and a setup failure
      // must not cost the previous version either.
      const fallback: Desired | undefined =
        replaced && registration
          ? {
              plugin: registration.plugin,
              source: registration.source,
              target: registration.target,
              version: registration.version,
              options: registration.options,
              enabled: registration.active,
            }
          : undefined
      if (replaced) {
        if (registration) await deactivateNoisily(id)
        // In-place replacement keeps the registration's key position, which
        // slot ordering (mode "replace" takes the last one) depends on.
        setStore("registrations", id, toRegistration(item))
      }
      if (!item.enabled) {
        await deactivateNoisily(id)
        continue
      }
      const error = await activate(id).then(() => undefined, errorMessage)
      if (!error) continue
      errors.set(id, error)
      if (!fallback) continue
      setStore("registrations", id, toRegistration(fallback))
      if (!fallback.enabled) continue
      const restored = await activate(id).then(
        () => true,
        () => false,
      )
      if (restored) errors.set(id, `${error} (previous version still active)`)
    }

    const failedTargets = new Set(failures.map((failure) => failure.target))
    const states: PluginState[] = [
      ...[...desired.values()].flatMap((item): PluginState[] => {
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
  createEffect(
    on(
      () => JSON.stringify(config.data.plugins ?? []),
      () => {
        npmFailures.clear()
        void enqueue(reconcile).then(
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
      stopWatching()
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
        // Manual dialog toggles join the same chain as reconciles so a
        // toggle mid-reload cannot mix registrations across generations.
        activate: (id) => enqueue(() => activate(id)),
        deactivate: (id) => enqueue(() => deactivate(id)),
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
