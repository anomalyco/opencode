import {
  createContext,
  createEffect,
  createMemo,
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  batch,
  useContext,
  type ParentProps,
  type JSX,
} from "solid-js"
import { createStore, produce, type Store, type SetStoreFunction } from "solid-js/store"
import { Schema } from "effect"
import type { Context, PanelProps, SessionContext, SlotClaim, Plugin } from "@opencode/plugin/desktop"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { createLifecycle } from "@opencode/plugin/desktop/lifecycle"
import { client } from "@opencode/plugin/desktop/rpc"
import { resolveSlots, type Claim, type PlacementKind } from "@opencode/plugin/slots"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs, tabKey } from "@/shell/tabs/tabs"
import { useCurrentRoute } from "@/shell/state/layout"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { persisted, Persist } from "@/runtime/persistence/storage"
import { extensionTabKey } from "./keys"
import { showToast } from "@/shell/notifications/toast"
import type { SessionServices } from "@opencode/plugin/desktop/workspace"

export type Contribution = Claim<{
  context: Context
  generation: number
  when?: () => boolean
  render: SlotClaim["render"]
}>
export type RegisteredPanel = {
  key: string
  plugin: string
  generation: number
  session: SessionContext
  props: PanelProps
  render: () => JSX.Element
  icon: () => JSX.Element
}
type PanelHost = { open(id: string): void; close(id: string): void; active(): string | undefined; visible?(): boolean }
const HostContext = createContext<ReturnType<typeof createHost>>()

export function DesktopExtensionsProvider(props: ParentProps) {
  const host = createHost()
  return <HostContext.Provider value={host}>{props.children}</HostContext.Provider>
}

export function useDesktopExtensions() {
  const host = useContext(HostContext)
  if (!host) throw new Error("Desktop extension host is unavailable")
  return host
}

export const useOptionalDesktopExtensions = () => useContext(HostContext)

function createHost() {
  const platform = usePlatform()
  const global = useGlobal()
  const tabs = useTabs()
  const route = useCurrentRoute()
  const commands = useCommand()
  const language = useLanguage()
  const owner = getOwner()
  const [state, setState] = createStore({
    claims: [] as Contribution[],
    panels: [] as RegisteredPanel[],
    sessions: [] as SessionContext[],
    services: {} as Record<string, SessionServices | undefined>,
    installed: [] as readonly ExtensionManager.Installed[],
    // Definitions are opaque: storing a factory prevents Solid from merging a
    // replacement into the previous definition and hiding its identity change.
    loaded: {} as Record<string, (() => Plugin.Definition) | undefined>,
    failures: {} as Record<string, boolean | undefined>,
    managerReady: false,
    managerError: undefined as ExtensionManager.ErrorCode | undefined,
  })
  const sessions = new Map<string, SessionContext>()
  const hosts = new Map<string, PanelHost>()
  const instances = new Map<string, { definition: object; dispose: () => void }>()
  const storage = new Map<string, unknown>()
  const memories = new Map<string, unknown>()
  const attempted = new WeakSet<Plugin.Definition>()
  let instanceID = 0
  const builtins = () => platform.extensionPlugins ?? []
  createEffect(() => {
    const manager = platform.extensionManager
    if (!manager) return
    let changed = false
    let disposed = false
    onCleanup(
      manager.onChange((entries) => {
        changed = true
        setState("installed", entries)
        setState("managerReady", true)
      }),
    )
    onCleanup(() => {
      disposed = true
    })
    void manager
      .list()
      .then((entries) => {
        if (disposed || changed) return
        setState("installed", entries)
        setState("managerReady", true)
      })
      .catch(() => {
        if (!disposed && !changed) {
          setState("managerError", "storage")
          setState("managerReady", true)
        }
      })
  })
  const pending = new Map<string, string>()
  createEffect(() => {
    const manager = platform.extensionManager
    if (!manager) return
    state.installed.forEach((entry) => {
      if (!entry.enabled) {
        pending.delete(entry.id)
        setState("loaded", entry.id, undefined)
        setState("failures", entry.id, undefined)
        return
      }
      const token = `${entry.revision}/${entry.generation}`
      if (pending.get(entry.id) === token) return
      pending.set(entry.id, token)
      setState("failures", entry.id, undefined)
      void (async () => {
        const { loadExtension } = await import("./load")
        const value = await loadExtension(await manager.source(entry.id, entry.revision))
        if (pending.get(entry.id) !== token) return
        setState("loaded", entry.id, () => () => value)
      })().catch((error) => {
        if (pending.get(entry.id) === token) {
          console.debug("[desktop-extensions] load failed", { id: entry.id, error })
          setState("failures", entry.id, true)
        }
      })
    })
  })
  onCleanup(() => pending.clear())
  const resolved = createMemo(() =>
    resolveSlots({
      paths: new Set([
        "app",
        "titlebar.actions",
        "settings.experimental",
        "session.panel",
        "session.panel.actions",
        "session.composer.top",
        "session.header.actions",
        "session.panel.toolbar",
        "session.panel.tools",
        "session.sidebar",
      ]),
      claims: state.claims.filter((claim) => claim.render.when?.() ?? true),
    }),
  )

  createEffect(() => {
    const all = global.servers.list()
    platform.extensions?.configure(
      all.map((connection) => ({
        id: ServerConnection.key(connection),
        ...connection.http,
        url: global.ensureServerCtx(connection).sdk.url,
      })),
    )
    const owned = new Set(tabs.store.filter((tab) => tab.type === "session").map(tabKey))
    Array.from(sessions).forEach(([key, session]) => {
      if (!owned.has(session.ownerID)) sessions.delete(key)
    })
    tabs.store.forEach((tab) => {
      if (tab.type !== "session") return
      const connection = all.find((connection) => ServerConnection.key(connection) === tab.server)
      if (!connection) return
      const data = global.ensureServerCtx(connection)
      const server = {
        id: tab.server,
        local: ServerConnection.local(connection),
        get client() {
          return data.sdk.api
        },
        data: data.data,
        get compatible() {
          return !global.servers.health[tab.server]?.incompatible
        },
      }
      Array.from(new Set([tab.sessionId, tab.routeSessionId ?? tab.sessionId])).forEach((id) => {
        const key = `${tab.server}\n${id}`
        if (sessions.has(key)) return
        sessions.set(key, {
          key,
          ownerID: tabKey(tab),
          sessionID: id,
          server,
          get creating() {
            return data.data.session.creating(id)
          },
          get location() {
            return data.data.session.get(id)?.location
          },
          get services() {
            return state.services[key]
          },
        })
      })
    })
    setState("sessions", Array.from(sessions.values()))
  })

  const current = createMemo(() => {
    const value = route()
    if (value.type !== "session") return
    return state.sessions.find((session) => session.server.id === value.server && session.sessionID === value.sessionId)
  })

  const stateFor = <Value extends object>(id: string, key: string, initial: Value, durable: boolean) => {
    const cache = durable ? storage : memories
    const name = `${id}.${key}`
    const previous = cache.get(name)
    if (previous) return previous as readonly [Store<Value>, (update: (draft: Value) => void) => void]
    // Storage decodes JSON objects at the boundary; each plugin owns its value's shape and migrations.
    const pair = runWithOwner(owner, () =>
      durable
        ? persisted(
            Persist.global(`extension.${name}`),
            Schema.Record(Schema.String, Schema.Json),
            Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(initial),
          )
        : createStore(initial),
    ) as unknown as readonly [Store<Value>, SetStoreFunction<Value>]
    const value = [pair[0], (update: (draft: Value) => void) => pair[1](produce(update))] as const
    cache.set(name, value)
    return value
  }

  const activate = (definition: NonNullable<typeof platform.extensionPlugins>[number]) =>
    createRoot((dispose) => {
      const lifecycle = createLifecycle()
      const id = definition.id
      const generation = ++instanceID
      let activated = false
      let nextClaim = 0
      const context: Context = {
        assets: {
          url(path) {
            const entry = state.installed.find((entry) => entry.id === id)
            if (!entry || !platform.extensionManager) throw new Error("Extension assets are unavailable")
            return platform.extensionManager.assetURL(id, entry.revision, path)
          },
        },
        app: { version: platform.version, windowID: platform.windowID, native: !!platform.extensions },
        lifecycle,
        platform: {
          ...platform,
          async saveFile(options, content) {
            if (platform.saveFile) return platform.saveFile(options, content)
            const url = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }))
            const link = document.createElement("a")
            link.href = url
            link.download = options.defaultPath ?? "download"
            link.click()
            URL.revokeObjectURL(url)
            return true
          },
        },
        sessions: { list: () => state.sessions, current },
        storage: {
          store: (key, options) => stateFor(id, key, options.initial, true),
          memory: (key, options) => stateFor(id, key, options.initial, false),
        },
        i18n: {
          locale: language.locale,
          intl: language.intl,
          plural: (key, count, params) => language.plural(key as Parameters<typeof language.plural>[0], count, params),
          t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params) ?? key,
        },
        commands: {
          register(values) {
            return lifecycle.own(
              createRoot((dispose) => {
                commands.register(`${id}/${generation}/${nextClaim++}`, () =>
                  values().map((command) => ({
                    id: command.reference ?? `${id}.${command.id}`,
                    title: command.title,
                    description: command.description,
                    category: command.group,
                    disabled: command.enabled === false,
                    hidden: command.palette === false,
                    keybind: command.bind,
                    slash: command.slash,
                    onSelect: () => {
                      void command.run()
                    },
                  })),
                )
                return dispose
              }),
            )
          },
          dispatch: (commandID) => commands.trigger(`${id}.${commandID}`),
        },
        main: {
          rpc(definition) {
            const transport = platform.extensions
            if (!transport) throw new Error("Native desktop extensions are unavailable on this platform")
            return client(id, definition, transport, lifecycle.signal, lifecycle.own)
          },
        },
        ui: {
          toast: {
            show: (options) =>
              showToast({ title: options.title, description: options.message, variant: options.variant }),
          },
          slot(claim) {
            const placements = ["append", "prepend", "before", "after", "replace"] as const
            const kinds = placements.filter((kind) => claim[kind] !== undefined)
            if (kinds.length !== 1) throw new Error("A slot requires exactly one placement")
            const kind: PlacementKind = kinds[0]
            const value: Contribution = {
              key: `${id}/${generation}/${nextClaim++}`,
              plugin: id,
              placement: { kind, target: claim[kind]! },
              render: { context, generation, when: claim.when, render: claim.render },
            }
            setState("claims", (items) => [...items, value])
            return lifecycle.own(() => setState("claims", (items) => items.filter((item) => item.key !== value.key)))
          },
          panel: {
            open(localID, session) {
              const panel = state.panels.find(
                (panel) => panel.plugin === id && panel.props.id === localID && panel.session.key === session.key,
              )
              const key = panel?.key ?? extensionTabKey(id, localID)
              const host = hosts.get(session.key)
              if (!host || !state.panels.some((panel) => panel.session.key === session.key && panel.key === key))
                return false
              host.open(key)
              return true
            },
            close(localID, session) {
              const key =
                state.panels.find(
                  (panel) => panel.plugin === id && panel.props.id === localID && panel.session.key === session.key,
                )?.key ?? extensionTabKey(id, localID)
              const host = hosts.get(session.key)
              if (!host) return false
              host.close(key)
              return true
            },
            selected: (localID, session) => {
              const panel = state.panels.find(
                (panel) => panel.plugin === id && panel.props.id === localID && panel.session.key === session.key,
              )
              return !!panel && hosts.get(session.key)?.active() === panel.key
            },
            visible: (localID, session) => {
              const panel = state.panels.find(
                (panel) => panel.plugin === id && panel.props.id === localID && panel.session.key === session.key,
              )
              const host = hosts.get(session.key)
              return !!panel && host?.active() === panel.key && (host.visible?.() ?? true)
            },
          },
        },
      }
      onCleanup(() => {
        try {
          lifecycle.dispose()
        } finally {
          if (activated) platform.extensions?.release(id)
        }
      })
      try {
        const cleanup = definition.setup(context)
        if (cleanup) lifecycle.own(cleanup)
        activated = true
        return dispose
      } catch (error) {
        dispose()
        throw error
      }
    })

  createEffect(() => {
    const definitions = [
      ...builtins(),
      ...Object.values(state.loaded)
        .flatMap((load) => (load ? [load()] : []))
        .filter((value) => !builtins().some((builtin) => builtin.id === value.id)),
    ]
    Array.from(instances).forEach(([id, instance]) => {
      if (definitions.some((definition) => definition.id === id)) return
      instance.dispose()
      instances.delete(id)
    })
    definitions.forEach((definition) => {
      if (instances.get(definition.id)?.definition === definition || attempted.has(definition)) return
      try {
        batch(() => {
          const dispose = untrack(() => activate(definition))
          instances.get(definition.id)?.dispose()
          instances.set(definition.id, { definition, dispose })
        })
      } catch (error) {
        if (builtins().includes(definition)) throw error
        console.debug("[desktop-extensions] activation failed", {
          id: definition.id,
          error: error instanceof Error ? error.stack : String(error),
        })
        setState("failures", definition.id, true)
        attempted.add(definition)
      }
    })
  })
  onCleanup(() => instances.forEach((instance) => instance.dispose()))
  return {
    state,
    resolved,
    current,
    transport: platform.extensions,
    manager: platform.extensionManager,
    builtins: (): readonly Plugin.Definition[] => builtins(),
    failed: (id: string) => setState("failures", id, true),
    zoom: () => platform.webviewZoom?.() ?? 1,
    bind(session: SessionContext, host: PanelHost, services?: SessionServices) {
      hosts.set(session.key, host)
      setState("services", session.key, services)
      return () => {
        if (hosts.get(session.key) === host) {
          hosts.delete(session.key)
          setState("services", session.key, undefined)
        }
      }
    },
    register(panel: RegisteredPanel) {
      if (state.panels.some((item) => item.key === panel.key && item.session.key === panel.session.key))
        throw new Error(`Duplicate extension panel: ${panel.key}`)
      setState("panels", (items) => [...items, panel])
      return () =>
        setState("panels", (items) =>
          items.filter((item) => item.key !== panel.key || item.session.key !== panel.session.key),
        )
    },
  }
}
