import { PluginContextProvider, type Plugin } from "@opencode-ai/plugin/tui"
import {
  batch,
  createContext,
  createEffect,
  createMemo,
  For,
  on,
  onCleanup,
  onMount,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import path from "path"
import { watch } from "fs"
import { stat } from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import type { Context, Dialog, Page, Slot, SlotMap, SlotName, Toast } from "@opencode-ai/plugin/tui/context"
import { createStore, produce, reconcile as reconcileStore } from "solid-js/store"
import { useRenderer } from "@opentui/solid"
import "#runtime-plugin-support"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useRoute } from "../context/route"
import { useTuiApp, useTuiLifecycle, useTuiPaths } from "../context/runtime"
import { useLocation } from "../context/location"
import { useThemes } from "../context/theme"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useAttention } from "../context/attention"
import { useStorage } from "../context/storage"
import { useSessionTabs } from "../context/session-tabs"
import { abbreviateHome } from "../util/path-format"
import { builtins } from "./builtins"
import { discoverTuiPlugins, freshSpecifier, localSource } from "./discovery"

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
  readonly slot: <Name extends SlotName>(name: Name) => ReadonlyArray<Slot<Name>>
  readonly activate: (id: string) => Promise<boolean>
  readonly deactivate: (id: string) => Promise<boolean>
}

type Dispose = () => Promise<void>
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
type Desired = {
  plugin: Plugin.Definition
  source: RegisteredPlugin["source"]
  target?: string
  version: string
  options?: Readonly<Record<string, any>>
  enabled: boolean
  // The source failed to re-import and this is the running previous version.
  stale?: boolean
}

const PluginContext = createContext<Value>()

export function PluginProvider(props: ParentProps<{ packages: PackageResolver }>) {
  const renderer = useRenderer()
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const config = useConfig()
  const keymap = Keymap.use()
  const shortcuts = Keymap.useShortcuts()
  const keymapState = Keymap.useState()
  const lifecycle = useTuiLifecycle()
  const app = useTuiApp()
  const paths = useTuiPaths()
  const location = useLocation()
  const themes = useThemes()
  const dialog = useDialog()
  const toast = useToast()
  const attention = useAttention()
  const storage = useStorage()
  const sessionTabs = useSessionTabs()
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
    let context: Context
    const dialogApi: Dialog = {
      show(render, onClose) {
        dialog.replace(() => <PluginContextProvider value={context}>{render()}</PluginContextProvider>, onClose)
      },
      set(options) {
        dialog.setSize(options.size ?? "medium")
        dialog.setCentered(options.centered ?? false)
      },
      clear() {
        dialog.clear()
      },
      alert(options) {
        return new Promise<void>((resolve) => {
          let settled = false
          const done = () => {
            if (settled) return
            settled = true
            resolve()
          }
          dialogApi.show(() => <DialogAlert title={options.title} message={options.message} onConfirm={done} />, done)
        })
      },
      confirm(options) {
        return new Promise<boolean | undefined>((resolve) => {
          let settled = false
          const done = (result: boolean | undefined) => {
            if (settled) return
            settled = true
            resolve(result)
          }
          dialogApi.show(
            () => (
              <DialogConfirm
                title={options.title}
                message={options.message}
                label={options.label}
                onConfirm={() => done(true)}
                onCancel={() => done(false)}
              />
            ),
            () => done(undefined),
          )
        })
      },
      prompt(options) {
        return new Promise<string | undefined>((resolve) => {
          let settled = false
          const done = (result: string | undefined) => {
            if (settled) return
            settled = true
            resolve(result)
          }
          dialogApi.show(
            () => (
              <DialogPrompt
                title={options.title}
                description={options.description ? () => <text>{options.description}</text> : undefined}
                placeholder={options.placeholder}
                value={options.value}
                onConfirm={(value) => {
                  done(value)
                  dialogApi.clear()
                }}
              />
            ),
            () => done(undefined),
          )
        })
      },
      select(options) {
        return new Promise((resolve) => {
          let settled = false
          const done = (result: (typeof options.options)[number]["value"] | undefined) => {
            if (settled) return
            settled = true
            resolve(result)
          }
          dialogApi.show(
            () => (
              <DialogSelect
                title={options.title}
                placeholder={options.placeholder}
                options={options.options.map((option) => ({ ...option }))}
                current={options.current}
                onSelect={(option) => {
                  done(option.value)
                  dialogApi.clear()
                }}
              />
            ),
            () => done(undefined),
          )
        })
      },
    }
    const toastApi: Toast = {
      show(options) {
        toast.show({ ...options, variant: options.variant ?? "info" })
      },
    }
    context = {
      options: item.options ?? {},
      get location() {
        return location.current
      },
      app: { version: app.version, channel: app.channel },
      renderer,
      client: client.api,
      data,
      attention,
      get theme() {
        return themes.currentTokens()
      },
      keymap: {
        layer: Keymap.createLayer,
        dispatch: keymap.dispatch,
        shortcuts: shortcuts.list,
        commands: keymapState.commands,
        pending: keymapState.pending,
        active: keymapState.active,
        mode: keymap.mode,
      },
      storage: {
        store: (key, options) => storage.store(`plugin.${item.plugin.id}.${key}`, options),
      },
      ui: {
        dialog: dialogApi,
        toast: toastApi,
        format: {
          path: (value) => abbreviateHome(value, paths.home),
        },
        router: {
          register(page) {
            if (store.registrations[item.plugin.id]?.routes[page.name])
              throw new Error(`Route already registered: ${page.name}`)
            setStore("registrations", item.plugin.id, "routes", page.name, {
              ...page,
              render: (input) => <PluginContextProvider value={context}>{page.render(input)}</PluginContextProvider>,
            })
            let registered = true
            const unregister = () => {
              if (!registered) return
              registered = false
              if (!store.registrations[item.plugin.id]?.active) return
              setStore(
                "registrations",
                produce((registrations) => {
                  if (!registrations[item.plugin.id]) return
                  delete registrations[item.plugin.id].routes[page.name]
                }),
              )
            }
            owned.push(async () => unregister())
            return unregister
          },
          navigate(destination) {
            if (destination.type === "plugin") {
              route.navigate({ ...destination, id: "id" in destination ? destination.id : item.plugin.id })
              return
            }
            route.navigate(destination)
          },
          current() {
            return route.data
          },
        },
        tabs: {
          enabled: sessionTabs.enabled,
          list: () =>
            sessionTabs.tabs().map((tab) => ({
              ...tab,
              active: sessionTabs.current() === tab.sessionID,
              ...sessionTabs.status(tab.sessionID),
            })),
          open(sessionID) {
            if (!sessionTabs.enabled()) return false
            sessionTabs.select(sessionID)
            return true
          },
          focus(sessionID) {
            if (!sessionTabs.enabled()) return false
            if (!sessionTabs.tabs().some((tab) => tab.sessionID === sessionID)) return false
            sessionTabs.select(sessionID)
            return true
          },
          close(sessionID) {
            if (!sessionTabs.enabled()) return false
            const target = sessionID ?? sessionTabs.current()
            if (!target || !sessionTabs.tabs().some((tab) => tab.sessionID === target)) return false
            sessionTabs.close(target)
            return true
          },
        },
        slot(name, render) {
          if (store.registrations[item.plugin.id]?.slots[name]) throw new Error(`Slot already registered: ${name}`)
          setStore("registrations", item.plugin.id, "slots", name, () => (input: SlotMap[typeof name]) => (
            <PluginContextProvider value={context}>{render(input)}</PluginContextProvider>
          ))
          let registered = true
          const unregister = () => {
            if (!registered) return
            registered = false
            if (!store.registrations[item.plugin.id]?.active) return
            setStore(
              "registrations",
              produce((registrations) => {
                if (!registrations[item.plugin.id]) return
                delete registrations[item.plugin.id].slots[name]
              }),
            )
          }
          owned.push(async () => unregister())
          return unregister
        },
      },
    }
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
  // Watches are deduped by path and never torn down individually (a stale
  // watch costs one fs handle and a no-op reconcile); all die with this
  // provider. Failed watches leave the set so a later reconcile can retry
  // once the path exists.
  const watchers: ReturnType<typeof watch>[] = []
  const watched = new Set<string>()
  let pending: ReturnType<typeof setTimeout> | undefined
  const changed = () => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      loading = loading.catch(() => undefined).then(() => reconcile())
      // Observe failures immediately: a plugin cleanup that throws would
      // otherwise surface as an unhandled rejection until the next trigger.
      void loading.catch(() => undefined)
    }, 100)
  }
  const watchSource = (target: string) => {
    if (watched.has(target)) return
    watched.add(target)
    stat(target)
      .then((info) => {
        // Watch the parent for files: editors that save by rename replace the
        // inode, which silently kills a direct file watch after the first save.
        const dir = info.isDirectory() ? target : path.dirname(target)
        if (dir !== target && watched.has(dir)) return
        watched.add(dir)
        const watcher = watch(dir, changed)
        // A watched directory can disappear out from under us; without a
        // listener the error event would crash the process. Forget the paths
        // so a later reconcile can re-arm once they exist again.
        watcher.on("error", () => {
          watcher.close()
          watched.delete(dir)
          watched.delete(target)
        })
        watchers.push(watcher)
      })
      .catch(() => watched.delete(target))
  }
  onCleanup(() => {
    clearTimeout(pending)
    for (const watcher of watchers) watcher.close()
  })

  // Rebuild the plugin generation as resolve → compare → swap, mirroring the
  // core plugin registry: fold the ordered entries into a desired end state
  // (importing only new or changed sources, before anything running is
  // touched), no-op when the generation is unchanged, and restart only the
  // plugins that differ. Membership or order changes rebuild the whole
  // generation to preserve slot-order semantics.
  const reconcile = async (configured = config.data.plugins ?? []) => {
    const entries = [...(await discoverTuiPlugins(paths.cwd)), ...configured]
    watchSource(path.join(paths.cwd, ".opencode", "plugins", "tui"))

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
      const resolved = await resolvePlugin(target, local, options, previous, props.packages).catch((error) => ({
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      }))
      if (resolved.status === "unsupported") {
        failures.push({ target, status: "unsupported" })
        continue
      }
      if (resolved.status === "failed") {
        failures.push({
          target,
          status: "failed",
          error: previous ? `${resolved.error} (previous version still active)` : resolved.error,
        })
        if (previous)
          desired.set(previous.plugin.id, {
            plugin: previous.plugin,
            source: "external",
            target,
            version: previous.version,
            options: previous.options,
            enabled: true,
            stale: true,
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
    const changed = desiredIds.filter((id) => {
      const registration = store.registrations[id]
      if (!registration) return true
      const item = desired.get(id)!
      return (
        registration.version !== item.version ||
        !sameOptions(registration.options, item.options) ||
        registration.active !== item.enabled
      )
    })

    // Swap: cleanup failures are logged into states, never propagated, so one
    // broken plugin cannot take the rest of the generation down.
    const errors = new Map<string, string>()
    const start = async (id: string) => {
      const error = await activate(id).then(
        () => undefined,
        (error) => (error instanceof Error ? error.message : String(error)),
      )
      if (error) errors.set(id, error)
    }
    if (structural) {
      await Promise.all(
        Object.entries(store.registrations)
          .filter(([, registration]) => registration.active)
          .map(([id]) => deactivate(id).catch(() => undefined)),
      )
      setStore("registrations", reconcileStore({}))
      for (const [id, item] of desired) {
        setStore("registrations", id, register(item))
        if (item.enabled) await start(id)
      }
    } else {
      for (const id of changed) {
        const item = desired.get(id)!
        const registration = store.registrations[id]!
        if (registration.version !== item.version || !sameOptions(registration.options, item.options)) {
          await deactivate(id).catch(() => undefined)
          // In-place replacement keeps the registration's key position, which
          // slot ordering (mode "replace" takes the last one) depends on.
          setStore("registrations", id, register(item))
        }
        if (item.enabled) await start(id)
        else await deactivate(id).catch(() => undefined)
      }
    }

    const states: State[] = [
      ...[...desired.values()].flatMap((item): State[] => {
        if (item.target === undefined || item.stale) return []
        const error = errors.get(item.plugin.id)
        if (error) return [{ target: item.target, status: "failed", error }]
        const status = store.registrations[item.plugin.id]?.active ? "active" : "inactive"
        return [{ target: item.target, id: item.plugin.id, status }]
      }),
      ...failures,
    ]
    if (JSON.stringify(states) === JSON.stringify(store.states)) return
    // Surface newly failing plugins; repeated reconciles stay silent.
    const known = new Set(store.states.flatMap((state) => (state.status === "failed" ? [state.target + state.error] : [])))
    for (const state of states)
      if (state.status === "failed" && !known.has(state.target + state.error))
        toast.show({ variant: "error", title: "Plugin", message: `${state.target}: ${state.error}` })
    setStore("states", states)
  }
  let loading = Promise.resolve()
  createEffect(
    on(
      () => JSON.stringify(config.data.plugins ?? []),
      () => {
        const configured = config.data.plugins ?? []
        loading = loading.catch(() => undefined).then(() => reconcile(configured))
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
          Object.values(store.registrations).flatMap((registration) =>
            registration.active && registration.slots[name] ? [registration.slots[name]] : [],
          ),
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
  const entrypoint = local ? await resolveLocal(local) : await packages.resolve(spec)
  if (!entrypoint) return { status: "unsupported" as const }
  const mtime = local ? (await stat(new URL(entrypoint))).mtimeMs : undefined
  const version = mtime === undefined ? entrypoint : `${entrypoint}?mtime=${mtime}`
  if (previous && previous.version === version && sameOptions(previous.options, options))
    return { status: "unchanged" as const, plugin: previous.plugin, version }
  const mod: { readonly default?: unknown } = await import(mtime === undefined ? entrypoint : freshSpecifier(entrypoint, mtime))
  if (!isPlugin(mod.default)) throw new Error(`Invalid V2 TUI plugin module: ${spec}`)
  return { status: "loaded" as const, plugin: mod.default, version }
}

function register(item: Desired): Registration {
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

function sameOptions(a: Readonly<Record<string, any>> | undefined, b: Readonly<Record<string, any>> | undefined) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
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

export function PluginRoute(props: { readonly fallback: (id: string, name: string) => JSX.Element }) {
  const plugins = usePlugin()
  const route = useRoute()
  const content = createMemo(() => {
    if (route.data.type !== "plugin") return
    const render = plugins.route(route.data.id, route.data.name)
    if (!render) return props.fallback(route.data.id, route.data.name)
    return render({ data: route.data.data })
  })
  return <>{content()}</>
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
  return <For each={renderers()}>{(render) => render(props.input)}</For>
}
