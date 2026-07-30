import { PluginContextProvider, type Plugin } from "@opencode-ai/plugin/tui"
import {
  batch,
  createContext,
  createMemo,
  For,
  onCleanup,
  onMount,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import path from "path"
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
import { discoverTuiPlugins } from "./discovery"

export interface PackageResolver {
  readonly resolve: (spec: string) => Promise<string | undefined>
}

type State =
  | { readonly target: string; readonly status: "loading" }
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
  options?: Readonly<Record<string, any>>
  active: boolean
  routes: Record<string, Page>
  slots: Record<string, Slot>
  cleanups: Dispose[]
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

  const reconcile = async () => {
    await Promise.all(
      Object.entries(store.registrations)
        .filter(([, registration]) => registration.active)
        .map(([id]) => deactivate(id)),
    )
    const entries = [...(await discoverTuiPlugins(paths.cwd)), ...(config.data.plugins ?? [])]
    batch(() => {
      setStore("registrations", reconcileStore({}))
      setStore("states", [])
    })

    for (const plugin of builtins) {
      setStore("registrations", plugin.id, {
        plugin,
        source: "builtin",
        active: false,
        routes: {},
        slots: {},
        cleanups: [],
      })
      await activate(plugin.id)
    }

    for (const entry of entries) {
      const target = typeof entry === "string" ? entry : entry.package
      if (target.startsWith("-")) {
        for (const id of Object.keys(store.registrations).filter((id) => matches(target.slice(1), id)))
          await deactivate(id)
        continue
      }

      const selected = Object.keys(store.registrations).filter((id) => matches(target, id))
      if (selected.length || target === "*" || target.endsWith(".*") || target.startsWith("opencode.")) {
        for (const id of selected) await activate(id)
        continue
      }

      const options = typeof entry === "string" ? undefined : entry.options
      setStore("states", (items) => [...items, { target, status: "loading" }])
      const plugin = await loadPlugin(target, directory, props.packages).catch((error) => {
        setStore("states", (items) =>
          items.map((state) =>
            state.target === target
              ? { target, status: "failed", error: error instanceof Error ? error.message : String(error) }
              : state,
          ),
        )
        return undefined
      })
      if (!plugin) {
        setStore("states", (items) =>
          items.map((state) =>
            state.target === target && state.status !== "failed" ? { target, status: "unsupported" } : state,
          ),
        )
        continue
      }

      setStore("registrations", plugin.id, {
        plugin,
        source: "external",
        options,
        active: false,
        routes: {},
        slots: {},
        cleanups: [],
      })
      const error = await activate(plugin.id).then(
        () => undefined,
        (error) => (error instanceof Error ? error.message : String(error)),
      )
      setStore("states", (items) => [
        ...items.filter((state) => state.target !== target && (!("id" in state) || state.id !== plugin.id)),
        error
          ? { target, status: "failed", error }
          : { target, id: plugin.id, status: "active" },
      ])
    }
  }
  onMount(() => {
    const loading = reconcile()
    let disposing: Promise<void> | undefined
    const dispose = () => {
      if (disposing) return disposing
      disposing = loading
        .catch(() => undefined)
        .then(() =>
          Promise.all(
            Object.entries(store.registrations)
              .filter(([, registration]) => registration.active)
              .map(([id]) => deactivate(id)),
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
    void loading.finally(() => setStore("ready", true))
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

async function loadPlugin(spec: string, directory: string, packages: PackageResolver) {
  const local = spec.startsWith("file://")
    ? new URL(spec)
    : spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec)
      ? pathToFileURL(path.resolve(directory, spec))
      : undefined
  const entrypoint = local ? await resolveLocal(local) : await packages.resolve(spec)
  if (!entrypoint) return
  const mod: { readonly default?: unknown } = await import(entrypoint)
  if (!isPlugin(mod.default)) throw new Error(`Invalid V2 TUI plugin module: ${spec}`)
  return mod.default
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
