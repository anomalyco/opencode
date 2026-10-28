import {
  batch,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  on,
  runWithOwner,
  untrack,
  type Accessor,
} from "solid-js"
import { createStore, produce, type Store } from "solid-js/store"
import type { Schema } from "effect"
import { useDialog } from "@opencode/ui/context/dialog"
import { useTheme } from "@opencode/ui/theme/context"
import { toaster } from "@opencode/ui/toast"
import { base64Encode } from "@opencode/util/encode"
import {
  type App,
  type Layout,
  type MountedSession,
  type NotifyOptions,
  type NotifyResult,
  type OpenOptions,
  type PanelSidebar,
  type PanelState,
  type ServerRef,
  type SessionRef,
  type SessionScreen,
  type ShellTab,
  type Storage,
  type StorageScope,
  type Tabs,
} from "@opencode/plugin/gui"
import { BuiltinPanel, type BuiltinStoreFrom, type BuiltinStoreOptions } from "@opencode/plugin/gui/builtin"
import { usePlatform } from "@/runtime/platform/platform"
import { same } from "@/runtime/persistence/equality"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { SessionRouteKey, SessionStateKey, type ServerScope } from "@/runtime/server/scope"
import { findSessionTab, tabKey, useTabs } from "@/shell/tabs/tabs"
import { openNotificationSession } from "@/shell/notifications/notification"
import { playSoundById } from "@/shell/notifications/sound"
import { showToast } from "@/shell/notifications/toast"
import { useCurrentRoute, useLayout } from "@/shell/state/layout"
import { sessionPaneTab, sessionTabPane, type SessionPane } from "@/shell/state/session-tabs"
import { terminalFontFamily, useSettings } from "@/settings/model"
import { useSettingsSurface } from "@/settings/surface"
import { formatKeybindParts, useCommand } from "@/shell/commands/command"
import { createMediaQuery } from "@solid-primitives/media"
import { useIsRouting, useLocation } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { closedEntry, createClosedTabs } from "./closed-tabs"
import { panelsMoving } from "@/shell/panel-motion"
import { createEmbeds } from "./embeds"
import { usePluginHost, type HostApiFactories } from "./host"
import { createLocatedWrites } from "./located"
import { createSessionPanelMenu } from "./panel-menu"
import type { Region } from "./panels"
import {
  deferredHandle,
  globalStoreTarget,
  persistedHandle,
  renamedFrom,
  renamedStoreName,
  storeImports,
  storeName,
} from "./stores"
import { ui } from "./ui"

type Attached = {
  sessions: Accessor<readonly SessionRef[]>
  current: Accessor<MountedSession | undefined>
  tabs: Tabs
  screen: Accessor<SessionScreen | undefined>
  scope: (server: string) => ServerScope
  /** Records a session-scoped store so layout pruning drops it with the session. */
  scoped: (name: string) => void
  layout: Omit<Layout, "narrow" | "settings" | "project" | "draft" | "command" | "stored"> & {
    stored(plugin: string, session: SessionRef): readonly string[]
  }
  settings: (page?: string) => void
  project: (server: string, title: string) => void
  draft: Layout["draft"]
  command: (id: string) => void
  run: (id: string) => boolean
  notify: (plugin: string, options: NotifyOptions) => Promise<NotifyResult>
  font: Accessor<string>
  mode: Accessor<"light" | "dark">
  routing: Accessor<boolean>
  path: Accessor<string>
  keybind: (command: string) => readonly string[]
  matches: (command: string, event: KeyboardEvent) => boolean
  servers: Accessor<readonly string[]>
  server: (id: string) => ServerRef | undefined
}

/**
 * HostApis the host owns. Session and layout attach once the app interface mounts; until then their reads return
 * their documented defaults and their writes wait, then apply in call order.
 */
export function createHostApis() {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  // The session screen's breakpoint, negated, so no fractional width is both narrow and desktop.
  const desktop = createMediaQuery("(min-width: 768px)")
  const narrow = () => !desktop()
  const systemDark = createMediaQuery("(prefers-color-scheme: dark)")
  const [attached, setAttached] = createSignal<Attached>()
  const removed = new Set<(value: { server: string; directory: string }) => void>()
  const memory = new Map<string, ReturnType<Storage["memory"]>>()
  const current = () => attached()
  // Writes made while the app interface is not mounted, in call order.
  const early: ((value: Attached) => void)[] = []
  // Removals of a session's store wait for its location, as layout writes do.
  const located = createLocatedWrites()

  // Runs a write now when the interface is mounted and nothing waits before it; otherwise once it mounts.
  const write = (run: (value: Attached) => void) => {
    const value = untrack(attached)

    if (value && early.length === 0) return run(value)
    early.push(run)
  }

  // Promise.try runs each write synchronously and isolates a throw, such as an unlisted server, from the later ones.
  const flush = () => {
    const value = untrack(attached)

    if (!value) return
    batch(() =>
      early
        .splice(0)
        .forEach(
          (run) => void Promise.try(() => run(value)).catch((cause: unknown) => console.error("[plugin]", cause)),
        ),
    )
  }

  const embeds = createEmbeds({
    bridge: platform.plugins,
    zoom: () => platform.webviewZoom?.() ?? 1,
    dialog: () => !!dialog.active,
    moving: panelsMoving,
  })

  // A server or session store's key needs the server's scope, which the mounted interface provides.
  const target = (
    plugin: string,
    key: string,
    scope: Exclude<StorageScope, "global">,
    from: BuiltinStoreFrom | readonly BuiltinStoreFrom[] | undefined,
    builtin: boolean,
    connected: Attached,
  ) => {
    const name = storeName(plugin, key)
    const renamed = renamedStoreName(plugin, key)
    // Only a built-in stored values before the rename.
    const older = (at: { readonly storage?: string; readonly key: string }) => (builtin ? [renamedFrom(at)] : [])

    if ("session" in scope) {
      const location = scope.session.location

      if (!location) throw new Error("Session storage requires a session location")
      // Pruning a session drops its value under both names.
      connected.scoped(name)
      connected.scoped(renamed)
      const server = connected.scope(scope.session.server.id)
      const directory = base64Encode(location.directory)
      const session = SessionStateKey.from(server, SessionRouteKey.fromRoute(directory, scope.session.id))
      const at = (store: string) => Persist.serverSession(server, directory, scope.session.id, store)

      return { ...at(name), copyFrom: [...older(at(renamed)), ...storeImports(from, session)] }
    }

    const server = connected.scope(scope.server)
    const directory = scope.directory

    const at = (store: string) =>
      directory === undefined
        ? Persist.serverGlobal(server, store)
        : Persist.serverWorkspace(server, base64Encode(directory), store)

    return { ...at(name), copyFrom: [...older(at(renamed)), ...storeImports(from)] }
  }

  const apis: HostApiFactories = {
    storage: (plugin, owner, _context, _register, builtin) => ({
      store<S extends Schema.ConstraintCodec<object, unknown>>(key: string, options: BuiltinStoreOptions<S>) {
        const open = (at: Parameters<typeof persisted>[0]) => {
          const pair = persisted(at, options.schema, options.initial, platform)

          return persistedHandle({ store: pair[0], set: pair[1], init: pair[3].promise })
        }

        const scope = options.scope

        // Persistence owns effects and resources; code after an await in setup has no owner.
        return runWithOwner(getOwner() ?? owner, () => {
          if (!scope || scope === "global") return open(globalStoreTarget(plugin, key, options.from, builtin))

          const scoped = (connected: Attached | undefined) =>
            connected && open(target(plugin, key, scope, options.from, builtin, connected))

          // A server store opens once the interface mounts. A session store also waits for the session's location, and
          // opens again in a new directory; the store a run opened disposes with the next run.
          if (!("session" in scope)) return deferredHandle(createMemo(on(attached, scoped)))

          const directory = createMemo(() => scope.session.location?.directory)

          return deferredHandle(
            createMemo(
              on([attached, directory], ([connected, value]) => (value === undefined ? undefined : scoped(connected))),
            ),
          )
        })!
      },
      memory<T extends object>(key: string, options: { readonly initial: T }) {
        const name = `${plugin}.${key}`
        const existing = memory.get(name)

        if (existing) {
          // SAFETY: a memory key is one plugin's store, which that plugin always opens with the same shape.
          return existing as readonly [Store<T>, (mutation: (draft: T) => void) => void]
        }

        const [store, setStore] = createStore(options.initial)
        const value = [store, (mutation: (draft: T) => void) => setStore(produce(mutation))] as const

        memory.set(name, value)

        return value
      },
      remove(key, options) {
        const scope = options?.scope

        if (!scope || scope === "global")
          return removePersisted(globalStoreTarget(plugin, key, options?.from, builtin), platform)

        const run = (connected: Attached) =>
          removePersisted(target(plugin, key, scope, options?.from, builtin, connected), platform)

        // A session's store is found through its location: the removal waits for it, as layout writes do.
        write((connected) =>
          "session" in scope && !scope.session.location
            ? located.hold(scope.session, () => write(run))
            : run(connected),
        )
      },
    }),
    system: () => ({
      copy: (text) => platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text),
      async save(file) {
        if (platform.saveFile) return platform.saveFile({ defaultPath: file.name }, file.content)
        const url = URL.createObjectURL(new Blob([file.content], { type: "application/octet-stream" }))
        const link = document.createElement("a")
        link.href = url
        link.download = file.name
        link.click()
        URL.revokeObjectURL(url)

        return true
      },
      openExternal(url) {
        if (platform.openLocalFile && URL.canParse(url) && new URL(url).protocol === "file:")
          return platform.openLocalFile(url)
        platform.openExternal(url)
      },
    }),
    desktop: () =>
      platform.platform === "desktop"
        ? {
            os: platform.os ?? "linux",
            zoom: () => platform.webviewZoom?.() ?? 1,
            launch: (path, app) => platform.openPath?.(path, app) ?? Promise.resolve(),
            reveal: (path) => platform.revealPath?.(path) ?? Promise.resolve(false),
            installed: (app) => platform.checkAppExists?.(app) ?? Promise.resolve(false),
            forceFocus: (enabled) => platform.setForceFocus?.(enabled) ?? Promise.resolve(),
            async pick(options) {
              if (options?.directory) {
                const picked = await platform.openDirectoryPickerDialog({
                  title: options.title,
                  multiple: options.multiple,
                })

                return picked === null ? [] : [picked].flat()
              }

              if (!platform.openFilePathPickerDialog) throw new Error("The file picker is unavailable")

              return (
                (await platform.openFilePathPickerDialog({
                  title: options?.title,
                  multiple: options?.multiple,
                  extensions: options?.extensions && [...options.extensions],
                })) ?? []
              )
            },
          }
        : undefined,
    app: () => ({
      name: "opencode",
      version: platform.version ?? "",
      // SAFETY: the build sets VITE_OPENCODE_CHANNEL to one of the release channels, or leaves it unset locally.
      channel: (import.meta.env.VITE_OPENCODE_CHANNEL ?? "local") as App["channel"],
      platform: platform.platform,
      packaged: platform.plugins?.packaged ?? false,
    }),
    locale: () => ({
      locale: language.intl,
      direction: language.direction,
      setDirection: language.setDirection,
    }),
    // Before the interface mounts, the default mono font and the system's color scheme.
    appearance: () => ({
      font: () => current()?.font() ?? terminalFontFamily(undefined),
      mode: () => current()?.mode() ?? (systemDark() ? "dark" : "light"),
    }),
    router: () => ({
      routing: () => current()?.routing() ?? false,
      path: () => current()?.path() ?? "",
    }),
    keybinds: () => ({
      keybind: (command) => current()?.keybind(command) ?? [],
      keys: (bind) => formatKeybindParts(bind, language.t),
      matches: (command, event) => current()?.matches(command, event) ?? false,
    }),
    servers: () => ({
      list: () => current()?.servers() ?? [],
      get: (id) => current()?.server(id),
    }),
    workspaces: (_plugin, _owner, _context, register) => ({
      on(_event, handler) {
        removed.add(handler)

        return register(() => {
          removed.delete(handler)
        })
      },
    }),
    sessions: () => ({
      list: () => current()?.sessions() ?? [],
      current: () => current()?.current(),
    }),
    // Before the interface mounts, no tabs are listed and writes wait for it.
    tabs: () => ({
      list: () => current()?.tabs.list() ?? [],
      open: (session, options) => write((value) => value.tabs.open(session, options)),
      focus: (key) => write((value) => value.tabs.focus(key)),
      move: (key, index) => write((value) => value.tabs.move(key, index)),
      close: (key) => write((value) => value.tabs.close(key)),
    }),
    toast: (_plugin, owner, _context, register) => ({
      show(options) {
        const id = showToast({
          title: options.title,
          description: options.description,
          variant: options.variant,
          icon: options.icon,
          duration: options.duration,
          persistent: options.persistent,
          actions: options.actions?.map((action) => ({
            label: action.label,
            // Promise.try isolates a throw, so the toast still closes.
            onClick: () =>
              void Promise.try(() => action.run()).catch((cause: unknown) => console.error("[plugin]", cause)),
          })),
        })

        const dismiss = () => void toaster.dismiss(id)

        // Under the plugin's root owner, so the toast closes with the plugin, not with the component that showed it.
        return { dismiss: runWithOwner(owner, () => register(dismiss)) ?? dismiss }
      },
    }),
    // The user's notification settings live in the app interface, so a notification waits for it to mount.
    attention: (plugin, _owner, context) => ({
      notify: (options) =>
        new Promise((resolve) =>
          write((value) => {
            if (context.signal.aborted) return resolve({ notification: false, sound: false })
            void value.notify(plugin, options).then(resolve)
          }),
        ),
    }),
    // No command is registered before the interface mounts.
    commands: () => ({ run: (id) => untrack(attached)?.run(id) ?? false }),
    screen: () => ({
      current: () => {
        const attached = current()

        return attached?.current() ? attached.screen() : undefined
      },
    }),
    // Before the interface mounts, reads return what an empty layout holds and writes wait for it.
    layout: (plugin) => ({
      narrow,
      ready: () => current()?.layout.ready() ?? false,
      open: (key, session, options) => write((value) => value.layout.open(key, session, options)),
      close: (key, session) => write((value) => value.layout.close(key, session)),
      toggle: (key, session) => write((value) => value.layout.toggle(key, session)),
      hide: (key, session) => write((value) => value.layout.hide(key, session)),
      state: (key, session) => current()?.layout.state(key, session) ?? "closed",
      stored: (session) => current()?.layout.stored(plugin, session) ?? [],
      side: {
        opened: (session) => current()?.layout.side.opened(session) ?? false,
        toggle: (session) => write((value) => value.layout.side.toggle(session)),
        menu: () => current()?.layout.side.menu() ?? [],
      },
      sidebar: { opened: () => current()?.layout.sidebar.opened() ?? true },
      scroll: {
        get: (session, key) => current()?.layout.scroll.get(session, key),
        set: (session, key, value) => write((connected) => connected.layout.scroll.set(session, key, value)),
      },
      settings: (page) => write((value) => value.settings(page)),
      project: (server, title) => write((value) => value.project(server, title)),
      draft: (input) => write((value) => value.draft(input)),
      command: (id) => write((value) => value.command(id)),
    }),
    embeds: () => embeds,
    ui: () => ui,
  }

  return {
    apis,
    /**
     * Runs `run` now while the app interface is mounted and no write waits; otherwise after the interface's first
     * render, behind the writes made before it. The returned function cancels a run that still waits.
     */
    whenMounted(run: () => void) {
      const state = { cancelled: false }

      write(() => {
        if (!state.cancelled) run()
      })

      return () => {
        state.cancelled = true
      }
    },
    attach(value: Attached) {
      setAttached(() => value)
      // After the interface's first render, so the waiting writes find its layout, in call order.
      queueMicrotask(flush)

      return () => {
        if (attached() === value) setAttached(undefined)
      }
    },
    workspaceRemoved(value: { server: string; directory: string }) {
      removed.forEach((handler) => handler(value))
    },
  }
}

export type HostApis = ReturnType<typeof createHostApis>

export { PluginAttachmentProvider, usePluginAttachment } from "./attachment"

/** Builds the session and layout attachment before readiness; its `attach` connects HostApis as the routes render. */
export function createPluginAttachment(apis: HostApis) {
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const route = useCurrentRoute()
  const settings = useSettings()
  const surface = useSettingsSurface()
  const host = usePluginHost()
  const command = useCommand()
  const location = useLocation()
  const platform = usePlatform()
  const theme = useTheme()
  const menu = createSessionPanelMenu()
  const desktop = createMediaQuery("(min-width: 768px)")
  const narrow = () => !desktop()
  // The mounted session screen, from its first render, and its object for the session it routes once it has mounted;
  // one screen is mounted at a time.
  const [screen, setScreen] = createSignal<SessionScreen>()
  const [routedView, setRoutedView] = createSignal<Accessor<MountedSession>>()
  const refs = new Map<string, SessionRef>()

  const connection = (id: string) => global.servers.list().find((item) => ServerConnection.key(item) === id)
  const servers = useServers()

  // One ref per server id. A restarted server (e.g. an updated WSL server) gets a new controller under the same id,
  // so the ref follows the live controller instead of the one it was created with.
  const owner = getOwner()
  const serverRefs = new Map<string, ServerRef>()

  const server = (id: string): ServerRef | undefined => {
    const conn = connection(id)

    if (!conn) return
    const existing = serverRefs.get(id)

    if (existing) return existing
    const key = ServerConnection.Key.make(id)
    // The controller starts on first use, not when the ref is made: reading `builtin` to find a server must not
    // connect to every listed server, such as one the runtime holds back because it rejects its credentials.
    let started: Accessor<ServerCtx> | undefined

    const live = () => {
      started ??= runWithOwner(owner, () =>
        createMemo<ServerCtx>(
          (previous) => global.serverCtx(key) ?? previous,
          global.ensureServerCtx(connection(id) ?? conn),
        ),
      )!

      return started()
    }

    // What the app's server list already says, without a controller.
    const listed = () => connection(id) ?? live().sdk.server

    const ref: ServerRef = {
      id,
      get name() {
        return servers.label(listed()) || id
      },
      get url() {
        return live().sdk.url
      },
      get password() {
        return live().sdk.server.http.password
      },
      get client() {
        return live().sdk.api
      },
      get data() {
        return live().data
      },
      get local() {
        return ServerConnection.local(listed())
      },
      get builtin() {
        return ServerConnection.builtin(listed())
      },
      get compatible() {
        return !global.servers.health[key]?.incompatible
      },
      get connected() {
        return live().sdk.connection.status() === "connected"
      },
    }

    serverRefs.set(id, ref)

    return ref
  }

  const sessions = createMemo(() => {
    const owned = new Set(tabs.store.filter((tab) => tab.type === "session").map(tabKey))
    Array.from(refs).forEach(([key, ref]) => {
      if (!owned.has(ref.tab)) refs.delete(key)
    })
    tabs.store.forEach((tab) => {
      if (tab.type !== "session") return
      const target = server(tab.server)

      if (!target) return
      Array.from(new Set([tab.sessionId, tab.routeSessionId ?? tab.sessionId])).forEach((id) => {
        const key = `${tab.server}\n${id}`

        if (refs.has(key)) return
        refs.set(key, {
          key,
          id,
          tab: tabKey(tab),
          server: target,
          get pending() {
            return target.data.session.creating(id)
          },
          get location() {
            return target.data.session.get(id)?.location
          },
        })
      })
    })

    return Array.from(refs.values())
  })

  const routed = createMemo(() => {
    const value = route()

    return value.type === "session" ? `${value.server}\n${value.sessionId}` : undefined
  })

  const current = createMemo(() => {
    const key = routed()
    const view = routedView()?.()

    return key && view?.key === key ? view : undefined
  })

  const scope = (id: string) => {
    const conn = connection(id)

    if (!conn) throw new Error(`Server ${id} is unavailable`)

    return global.ensureServerCtx(conn).sdk.scope
  }

  // The registry's scope is pure: an unlisted server's sessions (e.g. a stopped WSL server, whose tabs stay open) keep
  // their key, and no server controller starts for it.
  const stateKey = (session: SessionRef) => {
    const location = session.location

    if (!location) return

    return SessionStateKey.from(
      servers.scope(ServerConnection.Key.make(session.server.id)),
      SessionRouteKey.fromRoute(base64Encode(location.directory), session.id),
    )
  }

  // Each session's layout key, kept while its location is unknown (e.g. after the server re-authenticates).
  const stateKeys = createMemo<ReadonlyMap<string, string>>(
    (previous) =>
      new Map(
        sessions().flatMap((session) => {
          const value = stateKey(session) ?? previous.get(session.key)

          return value ? [[session.key, value] as const] : []
        }),
      ),
    new Map(),
  )

  // The strip is stored per directory, so a session that moves copies its strip to its new key: its tabs look the same
  // before and after the move. Synchronous, so no region renders the new key before the copy lands. A layout write
  // before desktop layout storage loads would stop it loading, so `lastKeys` keeps each session's first key until then.
  const lastKeys = new Map<string, string>()
  createComputed(() => {
    const next = stateKeys()
    Array.from(lastKeys.keys()).forEach((key) => {
      if (!next.has(key)) lastKeys.delete(key)
    })
    next.forEach((to, key) => {
      if (!lastKeys.has(key)) lastKeys.set(key, to)
    })

    if (!layout.ready()) return
    next.forEach((to, key) => {
      const from = lastKeys.get(key)

      if (!from || from === to) return
      layout.panel.copy(from, to)
      lastKeys.set(key, to)
    })
  })

  const shellTab = (session: SessionRef) =>
    findSessionTab(tabs.store, ServerConnection.Key.make(session.server.id), session.id)

  const sideOpened = (session: SessionRef) => !!tabs.region(shellTab(session), "side")

  // The side and split panes show with the side region; the bottom pane until the user hides it.
  const paneOpened = (session: SessionRef, pane: SessionPane) =>
    pane === "bottom" ? tabs.region(shellTab(session), "bottom", true) : sideOpened(session)

  // Shows the pane a stored tab landed in.
  const reveal = (session: SessionRef, value: string, key: string) =>
    tabs.setRegion(
      shellTab(session),
      sessionTabPane(layout.panel.state(value), key) === "bottom" ? "bottom" : "side",
      true,
    )

  // A token per session whose side region is open, new each time the region opens.
  const sideVisits = createMemo<ReadonlyMap<string, object>>(
    (previous) =>
      new Map(
        sessions().flatMap((session) =>
          sideOpened(session) ? [[session.key, previous.get(session.key) ?? {}] as const] : [],
        ),
      ),
    new Map(),
  )

  // The panel whose toggle opened a side region, by the region's token. However the region closes, it reopens with
  // a new token, so a region reopened any other way belongs to the user.
  const openedFor = new WeakMap<object, string>()

  // Keys are `${plugin}:${tab id}`.
  const provider = (key: string) => {
    const plugin = key.slice(0, key.indexOf(":"))

    return host.items(BuiltinPanel).find((item) => item.plugin === plugin)
  }

  const mountedSession = (session: SessionRef) => {
    const view = current()

    return view?.key === session.key ? view : undefined
  }

  // Counts routing visits: each change of the routed session, including to none (e.g. Home), starts the next one.
  const visit = createMemo(on(routed, (_key, _previous, count: number = 0) => count + 1))

  // The narrow-screen view belongs to the routed, mounted session for one visit, and reads as the conversation once
  // another visit starts. A view selected for a session that is not routed (e.g. a file link that opens Files on
  // another session) belongs to the next visit, which the navigation that follows starts.
  const [mobile, setMobile] = createStore<{ session: string | undefined; view: string; visit: number }>({
    session: undefined,
    view: "session",
    visit: 0,
  })

  const mobileView = createMemo(() =>
    mobile.session === current()?.key && mobile.visit === visit() ? mobile.view : "session",
  )

  const selectMobile = (session: SessionRef, view: string) =>
    setMobile({ session: session.key, view, visit: session.key === routed() ? visit() : visit() + 1 })

  // The side tabs a mounted session lists right now, plus `adding` as if it were stored; unmounted sessions have none.
  const listed = (session: SessionRef, value: string, adding?: string) => {
    const view = mountedSession(session)
    const currentScreen = screen()

    if (!view || !currentScreen) return []
    const all = layout.panel.state(value).all
    const stored = adding && !all.includes(adding) ? [...all, adding] : all

    return untrack(() =>
      host
        .items(BuiltinPanel)
        .filter((item) => item.value.region === "side")
        .flatMap((item) => {
          const prefix = `${item.plugin}:`
          const open = stored.flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))

          return item.value
            .list({
              get session() {
                return mountedSession(session) ?? view
              },
              screen: currentScreen,
              open,
            })
            .map((tab) => ({ key: `${prefix}${tab.id}`, tab }))
        }),
    )
  }

  // Writes made before a session's location is known wait for it rather than being dropped.
  const located = createLocatedWrites()

  // Kept per session beside its strip, so the new tab view still lists them after a reload.
  const closed = createClosedTabs({
    list(session) {
      const value = stateKey(session)

      return value ? layout.panel.closed(value) : []
    },
    write(session, entries) {
      const value = stateKey(session)

      if (value) layout.panel.setClosed(value, entries)
    },
  })

  const open = (key: string, session: SessionRef, options?: OpenOptions) => {
    const item = provider(key)

    const value = stateKey(session)

    if (!value) return located.hold(session, () => open(key, session, options))
    const placement = options?.tab ?? "open"

    // An append adds the tab quietly: no selection, no region change, no preview replacement.
    if (placement === "append") return layout.panel.append(value, key)

    // A select keeps the narrow-screen view, as a background open does, and shows the tab's pane too.
    if (placement === "select")
      return batch(() => {
        layout.panel.append(value, key)
        layout.panel.focus(value, key)
        reveal(session, value, key)
      })
    // Lists the opened tab too, so its own fields apply before it is stored. The next preview replaces a transient tab.
    const known = listed(session, value, key)
    const transient = new Set(known.flatMap((entry) => (entry.tab.transient ? [entry.key] : [])))
    const first = known.some((entry) => entry.key === key && entry.tab.first)
    batch(() => {
      if (narrow() && !options?.background) {
        if (item?.value.mobile) selectMobile(session, `${item.plugin}:${item.value.id}`)

        // A tab its panel does not list, or a transient one, stays unstored: the open only selects the panel's view.
        if (mountedSession(session) && !known.some((entry) => entry.key === key && !entry.tab.transient)) return
      }

      // Pinned tabs are listed without being stored; opening one only selects it.
      if (known.some((entry) => entry.key === key && entry.tab.pinned)) layout.panel.focus(value, key)
      else if (placement === "preview") layout.panel.preview(value, key, transient)
      else layout.panel.open(value, key, transient, first)

      // A background open keeps the narrow-screen view, but its tab still shows once the window is wide.
      if (!narrow() || options?.background) reveal(session, value, key)
    })
  }

  const close = (key: string, session: SessionRef) => {
    const item = provider(key)

    const value = stateKey(session)

    if (!value) return located.hold(session, () => close(key, session))

    const tab = listed(session, value).find((entry) => entry.key === key)?.tab
    const all = layout.panel.state(value).all
    const view = mountedSession(session)
    const currentScreen = screen()

    const entry =
      view &&
      tab &&
      currentScreen &&
      item &&
      closedEntry(key, item.value, { tab, session: view, screen: currentScreen })

    if (entry) closed.push(session, entry)
    batch(() => {
      layout.panel.close(value, key)

      // Closing the last tab closes the side region, which opens with a new tab next time.
      if (all.length === 1 && all[0] === key) tabs.setRegion(shellTab(session), "side", false)
    })

    if (view && tab && currentScreen) item?.value.close?.({ tab, session: view, screen: currentScreen })
  }

  // The routed session's side region, which knows the fallback selection the stored state lacks.
  const [region, setRegion] = createSignal<Region>()
  // The session screen's inner sidebar preference, which its side panels share.
  const [sidebar, setSidebar] = createSignal<PanelSidebar>()

  const opened = createMemo(
    () => Array.from(new Set((region()?.entries() ?? []).flatMap((entry) => entry.tab.file ?? []))),
    [],
    { equals: same },
  )

  const state = (key: string, session: SessionRef): PanelState => {
    const value = stateKey(session)

    if (!value) return "closed"
    const panel = layout.panel.state(value)
    const mounted = mountedSession(session) ? region() : undefined
    const pane = mounted ? mounted.paneOf(key) : sessionTabPane(panel, key)
    const shown = mounted ? mounted.pane(pane).active() : sessionPaneTab(panel, pane)

    if (shown !== key) return panel.all.includes(key) ? "open" : "closed"

    return paneOpened(session, pane) ? "visible" : "active"
  }

  const hide = (key: string, session: SessionRef) => {
    const value = stateKey(session)

    if (!value) return located.hold(session, () => hide(key, session))

    if (state(key, session) !== "visible") return
    const pane = mountedSession(session) ? region()?.paneOf(key) : sessionTabPane(layout.panel.state(value), key)
    tabs.setRegion(shellTab(session), pane === "bottom" ? "bottom" : "side", false)
  }

  // Open-project requests wait until their server is listed (e.g. an SSH server that just connected).
  const picker = useDirectoryPicker()
  const [projects, setProjects] = createSignal<readonly { server: string; title: string }[]>([])
  createEffect(() => {
    const pending = projects()

    const ready = pending.flatMap((request) => {
      const server = servers.list.find((conn) => ServerConnection.key(conn) === request.server)

      return server ? [{ request, server }] : []
    })

    if (ready.length === 0) return
    setProjects(pending.filter((request) => !ready.some((item) => item.request === request)))
    untrack(() =>
      ready.forEach(({ request, server }) =>
        picker({
          server,
          title: request.title,
          onSelect: (value) => {
            const directory = Array.isArray(value) ? value[0] : value

            if (!directory) return
            const key = ServerConnection.key(server)
            void global.ensureServerCtx(server).projects.add(directory)
            void tabs.newDraft({ server: key, directory })
          },
        }),
      ),
    )
  })

  const toggle = (key: string, session: SessionRef) => {
    const value = stateKey(session)

    if (!value) return located.hold(session, () => toggle(key, session))
    const region = sideVisits().get(session.key)

    if (state(key, session) === "visible") {
      batch(() => {
        close(key, session)

        // Closing the last panel the region was opened for also closes the region.
        if (region && openedFor.get(region) === key && layout.panel.state(value).all.length === 0)
          tabs.setRegion(shellTab(session), "side", false)
      })

      return
    }

    // A panel opened into an open region makes the region the user's.
    if (region) openedFor.delete(region)
    open(key, session)
    const opened = sideVisits().get(session.key)

    if (!region && opened) openedFor.set(opened, key)
  }

  const setScroll = (session: SessionRef, key: string, next: { readonly x: number; readonly y: number }) => {
    const value = stateKey(session)

    if (!value) return located.hold(session, () => setScroll(session, key, next))
    layout.panel.setScroll(value, key, next)
  }

  // The tab the route shows: a session's, a draft's, or none (Home, Settings).
  const routedTab = () => {
    const value = route()

    if (value.type === "session") return findSessionTab(tabs.store, value.server, value.sessionId)

    if (value.type !== "draft") return

    return tabs.store.find((tab) => tab.type === "draft" && tab.draftID === value.draftID)
  }

  const shellTabs = createMemo((): readonly ShellTab[] => {
    const refs = new Map(sessions().map((ref) => [ref.key, ref]))
    const active = routedTab()

    return tabs.store.map((tab) => ({
      key: tabKey(tab),
      session: tab.type === "session" ? refs.get(`${tab.server}\n${tab.sessionId}`) : undefined,
      active: tab === active,
    }))
  })

  const findTab = (key: string) => tabs.store.find((tab) => tabKey(tab) === key)

  // Opens a session as the session list and the app's notifications do; an unlisted server opens nothing.
  const openSession: Tabs["open"] = (session, options) => {
    const conn = servers.list.find((item) => ServerConnection.key(item) === session.server)

    if (!conn) return
    const key = ServerConnection.key(conn)
    const shown = findSessionTab(tabs.store, key, session.id)

    // A tab that already routes the session, e.g. a subagent opened from its parent's tab, keeps its route.
    if (shown?.type === "session" && shown.routeSessionId === session.id) {
      if (options?.focus) tabs.select(shown)

      return
    }

    if (!options?.focus) return void tabs.addSessionTab({ server: key, sessionId: session.id })
    openNotificationSession(tabs, key, session.id)
  }

  const shell: Tabs = {
    list: shellTabs,
    open: openSession,
    focus(key) {
      const tab = findTab(key)

      if (tab) tabs.select(tab)
    },
    move(key, index) {
      const keys = tabs.store.map(tabKey).filter((item) => item !== key)

      if (keys.length === tabs.store.length) return
      const at = Math.min(Math.max(0, Math.trunc(index)), keys.length)
      tabs.reorder([...keys.slice(0, at), key, ...keys.slice(at)])
    },
    close(key) {
      const index = tabs.store.findIndex((tab) => tabKey(tab) === key)

      if (index !== -1) tabs.closeTab(index)
    },
  }

  // Runs a command as the palette does; a listed but disabled command does not run.
  const run = (id: string) => {
    const option = untrack(() => command.options.find((item) => item.id === id))

    if (!option?.onSelect || option.disabled) return false
    const select = option.onSelect
    void Promise.try(() => select("palette")).catch((cause: unknown) => console.error("[plugin]", cause))

    return true
  }

  // Follows the user's settings for the app's own notifications: Agent, or Errors for `error`. The coordinator shows a
  // keyed notification once across windows, and only while none of them has focus.
  const notify = async (plugin: string, options: NotifyOptions): Promise<NotifyResult> => {
    const error = options.variant === "error"

    const allowed = untrack(() => ({
      notification: error ? settings.notifications.errors() : settings.notifications.agent(),
      sound: options.sound !== false && (error ? settings.sounds.errorsEnabled() : settings.sounds.agentEnabled()),
      id: error ? settings.sounds.errors() : settings.sounds.agent(),
    }))

    const key = `plugin:${plugin}\0${options.id ?? crypto.randomUUID()}`
    const result = { notification: false, sound: false }
    const session = options.session

    await Promise.allSettled([
      allowed.sound &&
        global.notifications.sound(key, () => {
          result.sound = true

          return playSoundById(allowed.id)
        }),
      allowed.notification &&
        global.notifications.system(key, () => {
          result.notification = true

          return platform.notify(
            options.title,
            options.message,
            session && (() => openSession(session, { focus: true })),
          )
        }),
    ])

    return result
  }

  const mounted: Attached = {
    sessions,
    current,
    tabs: shell,
    run,
    notify,
    mode: theme.mode,
    screen,
    scope,
    scoped: layout.sessionState.track,
    project: (server, title) => setProjects((pending) => [...pending, { server, title }]),
    draft: (input) => {
      const server = servers.list.find((conn) => ServerConnection.key(conn) === input.server)

      if (server) void tabs.newDraft({ server: ServerConnection.key(server), directory: input.directory }, input.prompt)
    },
    command: (id) => void run(id),
    font: () => terminalFontFamily(settings.appearance.terminalFont()),
    routing: useIsRouting(),
    path: () => `${location.pathname}${location.search}`,
    keybind: command.keybindParts,
    matches: command.matches,
    servers: () => global.servers.list().map(ServerConnection.key),
    server,
    // SAFETY: a plugin names a page it contributed through `SettingsPage`, which settings lists as a plugin tab.
    settings: (page) => surface.open(page as Parameters<typeof surface.open>[0]),
    layout: {
      ready: layout.ready,
      open,
      close,
      toggle,
      hide,
      state,
      stored(plugin, session) {
        const value = stateKey(session)

        if (!value) return []
        const prefix = `${plugin}:`

        return layout.panel
          .state(value)
          .all.flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))
      },
      side: {
        opened: sideOpened,
        toggle: (session) => tabs.setRegion(shellTab(session), "side", !sideOpened(session)),
        menu,
      },
      // Open is the stored preference's default, which holds until a session screen shows the preference.
      sidebar: { opened: () => sidebar()?.opened() ?? true },
      scroll: {
        get(session, key) {
          const value = stateKey(session)

          return value ? layout.panel.scroll(value, key) : undefined
        },
        set: setScroll,
      },
    },
  }

  return {
    /**
     * Mounts the interface for the HostApis; returns its detach. Called as the routes first render, which waits for
     * every plugin to settle, so writes and dialogs made before then apply after that render.
     */
    attach: () => apis.attach(mounted),
    /** The routed `MountedSession`. */
    current,
    closed,
    /** Opens and selects a side tab by key, as a reopened closed tab comes back. */
    openTab: (key: string, session: SessionRef) => open(key, session, { tab: "select" }),
    region(value: Region) {
      setRegion(() => value)

      return () => {
        if (region() === value) setRegion(undefined)
      }
    },
    /** The session screen's inner sidebar preference, which `Layout.sidebar` reads. */
    sidebar(value: PanelSidebar) {
      setSidebar(() => value)

      return () => {
        if (sidebar() === value) setSidebar(undefined)
      }
    },
    /** Workspace files the routed session's side tabs show, in strip order, and the selected one. */
    files: {
      opened,
      active: () => region()?.selected()?.tab.file,
    },
    mobile: {
      current: mobileView,
      select(view: string) {
        const session = current()

        if (session) selectMobile(session, view)
      },
    },
    /** A screen started rendering: `Screen.current` returns it only while its session matches the route. */
    screen(value: SessionScreen) {
      setScreen(() => value)

      return () => {
        if (screen() === value) setScreen(undefined)
      }
    },
    /** A session screen mounted: `Sessions.current` reads its object for the routed session. */
    mount(view: Accessor<MountedSession>) {
      setRoutedView(() => view)

      return () => {
        if (routedView() === view) setRoutedView(undefined)
      }
    },
    /** Starts loading every plugin's declared session stores for a session the screen routes. */
    preload(view: MountedSession) {
      untrack(() => host.preload(view))
    },
  }
}
